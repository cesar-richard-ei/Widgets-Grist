'use strict';

const path = require('path');
const base = require('@playwright/test');
const test = base.test;
const expect = base.expect;

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

// Un titre qui ne tient pas dans sa barre est reporté à côté plutôt que tronqué. Le critère est le
// débordement réel du texte, pas une largeur de barre en dessous d'un seuil : une barre large peut
// porter un titre long, et une barre étroite un titre court.

const jour = 86400;
const aujourdhui = Math.floor(Date.now() / 1000 / jour) * jour;
const j = (n) => aujourdhui + n * jour;

const DOC = {
    Projects: { columns: { nom: { type: 'Text' }, couleur: { type: 'Text' }, actif: { type: 'Bool' } }, records: [{ id: 1, nom: 'Portail', couleur: '#3e5de7', actif: true }] },
    Team: { columns: { nom: { type: 'Text' }, actif: { type: 'Bool' }, couleur: { type: 'Text' } }, records: [{ id: 1, nom: 'Alice Martin', actif: true, couleur: '#3e5de7' }] },
    Tasks: {
        columns: {
            parentTask: { type: 'Ref:Tasks' }, titre: { type: 'Text' }, description: { type: 'Text' },
            dateDebut: { type: 'Date' }, dateEcheance: { type: 'Date' }, priorite: { type: 'Choice' },
            statut: { type: 'Choice' }, progression: { type: 'Numeric' }, assignees: { type: 'RefList:Team' },
            type: { type: 'Choice' }, dependDe: { type: 'RefList:Tasks' }, tags: { type: 'ChoiceList' },
            estimationH: { type: 'Numeric' }, tempsPasse: { type: 'Numeric' }, couleur: { type: 'Text' },
            subtasks: { type: 'Text' }, projet: { type: 'Ref:Projects' }, charges: { type: 'Text' }, dateCloture: { type: 'Date' }
        },
        records: [
            { id: 1, titre: 'Analyse Plateforme Applicative et Cartographie des Usages', projet: 1, dateDebut: j(0), dateEcheance: j(30), statut: 'todo', type: 'tache', priorite: '2' },
            { id: 2, titre: 'Recette', projet: 1, dateDebut: j(0), dateEcheance: j(40), statut: 'todo', type: 'tache', priorite: '2' },
            { id: 3, titre: 'Fin de plage', projet: 1, dateDebut: j(150), dateEcheance: j(152), statut: 'todo', type: 'tache', priorite: '2' }
        ]
    }
};

async function ouvrirGantt(page) {
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: CHEMIN_SIMULACRE });
    await page.addInitScript((d) => { window.grist = window.createFakeGrist(d); try { localStorage.clear(); } catch (e) {} }, DOC);
    await page.goto('http://localhost:3001/tasks_app/gantt.html');
    await page.waitForSelector('#timelineGrid .gantt-bar');
}

const barre = (page, id) => page.locator('#timelineGrid .gantt-bar[data-id="' + id + '"]');

test('un titre trop long pour sa barre est reporte a cote', async ({ page }) => {
    await ouvrirGantt(page);

    await expect(barre(page, 1).locator('.gantt-bar-external-label')).toBeVisible();
    await expect(barre(page, 1).locator('.gantt-bar-label')).toBeHidden();

    // Présent dans le DOM ne suffit pas : la barre découpe ce qui dépasse d'elle tant qu'elle
    // garde son overflow, et le titre reporté disparaît à l'écran sans qu'aucun test ne bronche.
    const decoupe = await barre(page, 1).evaluate((b) => {
        const l = b.querySelector('.gantt-bar-external-label').getBoundingClientRect();
        const r = b.getBoundingClientRect();
        return getComputedStyle(b).overflowX === 'hidden' && (l.right > r.right || l.left < r.left);
    });
    expect(decoupe).toBe(false);
});

test('un titre court reste dans sa barre', async ({ page }) => {
    await ouvrirGantt(page);

    await expect(barre(page, 2).locator('.gantt-bar-label')).toBeVisible();
    await expect(barre(page, 2).locator('.gantt-bar-external-label')).toBeHidden();
});

test('aucun titre n est tronque a l ecran', async ({ page }) => {
    await ouvrirGantt(page);

    const tronques = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('#timelineGrid .gantt-bar:not(.parent)'))
            .filter(b => {
                const dedans = b.querySelector('.gantt-bar-label');
                if (!dedans || getComputedStyle(dedans).display === 'none') return false;
                return dedans.scrollWidth > dedans.clientWidth + 1;
            }).length;
    });
    expect(tronques).toBe(0);
});

test('en fin de plage, le titre passe a gauche pour rester lisible', async ({ page }) => {
    await ouvrirGantt(page);

    const debordeADroite = await page.evaluate(() => {
        const grille = document.getElementById('timelineGrid');
        const largeur = grille.scrollWidth;
        return Array.from(grille.querySelectorAll('.gantt-bar-external-label'))
            .filter(l => getComputedStyle(l).display !== 'none')
            .some(l => {
                const b = l.getBoundingClientRect();
                const g = grille.getBoundingClientRect();
                return (b.right - g.left) > largeur + 1;
            });
    });
    expect(debordeADroite).toBe(false);
});

// Le titre reporté se lit par-dessus la grille et, au défilement, par-dessus d'autres éléments :
// son fond doit être opaque et son contraste tenir dans les deux thèmes.
const contrasteDuTitre = (page) => page.evaluate(() => {
    const l = document.querySelector('.gantt-bar.narrow-bar .gantt-bar-external-label');
    const canal = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const lum = (c) => {
        const [r, g, b] = c.match(/\d+/g).map(Number);
        return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
    };
    const style = getComputedStyle(l);
    const a = lum(style.color), b = lum(style.backgroundColor);
    return { opaque: !/rgba\([^)]*,\s*0?\.\d+\)/.test(style.backgroundColor), ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
});

for (const theme of ['light', 'dark']) {
    test('le titre reporte reste lisible en theme ' + theme, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme });
        await ouvrirGantt(page);

        const { opaque, ratio } = await contrasteDuTitre(page);
        expect(opaque).toBe(true);
        expect(ratio).toBeGreaterThanOrEqual(4.5);
    });
}
