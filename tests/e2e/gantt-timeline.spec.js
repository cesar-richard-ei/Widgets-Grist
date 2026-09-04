'use strict';

const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

// La timeline : où elle se cale à l'ouverture, jusqu'où elle laisse remonter, comment elle libelle
// ses mois, et le déplacement d'un jalon à la souris.

const VUES = ['month', 'quarter', 'semester', 'year'];

async function choisirVue(page, vue) {
    await page.locator('.view-controls .btn[data-view="' + vue + '"]').click();
    await page.waitForSelector('.view-controls .btn[data-view="' + vue + '"].active');
    // La classe active est posée avant le rendu, qui lui est reporté au relâchement du clic.
    await D.attendreRendu(page);
}

// Écart, en colonnes, entre le défilement obtenu et celui visé : le début de la sur-colonne qui
// contient la ligne du jour vient au bord gauche avec 12 px de marge, borné au premier tiers
// visible et au défilement disponible. Un seuil en pixels ne tiendrait pas, la marge croissant
// avec le jour du mois puisque la sur-colonne visée est le mois courant.
const ecartAuCalage = (page) => page.evaluate(() => {
    const sc = document.getElementById('timelineScroll');
    const ligne = document.querySelector('#timelineGrid .today-line');
    if (!sc || !ligne) return null;

    const x = parseInt(ligne.style.left, 10);
    const colonne = document.querySelector('#timelineHeader .day-cell').getBoundingClientRect().width;

    let debutSurColonne = 0;
    for (let pos = 0, cellules = document.querySelectorAll('#timelineHeader .month-cell'), i = 0; i < cellules.length; i++) {
        const largeur = parseFloat(cellules[i].style.width);
        if (x < pos + largeur) { debutSurColonne = pos; break; }
        pos += largeur;
    }

    const vise = Math.max(debutSurColonne - 12, x - sc.clientWidth / 3);
    const defilement = Math.min(Math.max(vise, 0), sc.scrollWidth - sc.clientWidth);
    return (defilement - sc.scrollLeft) / colonne;
});

// Jours entre le début de la plage dessinée et la tâche la plus ancienne : négatif si la plage
// commence après elle, donc si le passé reste inatteignable.
const margeAvantLaPlusAncienne = (page) => page.evaluate(() => {
    const plusAncienne = Math.min(...tasks.filter((t) => t.dateDebut).map((t) => t.dateDebut));
    return Math.round((plusAncienne * 1000 - effectiveStart.getTime()) / 86400000);
});

test('à l ouverture, la ligne du jour est calée près du bord gauche', async ({ page }) => {
    await D.ouvrirGantt(page);

    await expect.poll(() => ecartAuCalage(page)).toBeCloseTo(0, 0);
});

for (const vue of VUES) {
    test('la vue ' + vue + ' se cale sur le jour et remonte jusqu à la tâche la plus ancienne', async ({ page }) => {
        await D.ouvrirGantt(page);

        await choisirVue(page, vue);

        await expect.poll(() => ecartAuCalage(page)).toBeCloseTo(0, 0);
        expect(await margeAvantLaPlusAncienne(page)).toBeGreaterThanOrEqual(0);
    });
}

test('le bouton Aujourd hui ramène la vue sur le jour', async ({ page }) => {
    await D.ouvrirGantt(page);
    await page.locator('#timelineScroll').evaluate((el) => { el.scrollLeft = el.scrollWidth; });

    await page.getByRole('button', { name: "Aujourd'hui" }).click();

    await expect.poll(() => ecartAuCalage(page)).toBeCloseTo(0, 0);
});

test('la navigation avance et recule d un mois en vue semestre', async ({ page }) => {
    await D.ouvrirGantt(page);
    await choisirVue(page, 'semester');
    const libelle = page.locator('#currentPeriod');
    const depart = await libelle.textContent();

    await page.locator('.btn-nav').last().click();

    // Le libellé est réécrit au rendu suivant : le lire aussitôt le trouve encore inchangé.
    await expect(libelle).not.toHaveText(depart);

    await page.locator('.btn-nav').first().click();

    await expect(libelle).toHaveText(depart);
});

// Le Gantt s'ouvre toujours ancre sur aujourd'hui, quelle que soit l'anciennete des taches. Le
// bouton « Ajuster » calait la vue sur la tache la plus ancienne et basculait en vue Annee au-dela
// de 200 jours : un clic suffisait a se retrouver des annees en arriere sans comprendre pourquoi.
test('une tache vieille de trois ans ne deplace pas l ouverture', async ({ page }) => {
    const doc = D.documentCible();
    const anciennete = 3 * 365;
    doc.Tasks.records.push({ id: 7, titre: 'Vieux sujet', chantier: 1, dateDebut: D.j(-anciennete), dateEcheance: D.j(-anciennete + 30), statut: 'done', type: 'tache', priorite: '3' });
    await D.ouvrirGantt(page, doc);
    await D.attendreRendu(page);

    const etat = await page.evaluate(() => {
        const sc = document.getElementById('timelineScroll');
        const ligne = document.querySelector('#timelineGrid .today-line');
        const x = parseInt(ligne.style.left, 10) - sc.scrollLeft;
        return { vue: currentView, visible: x >= 0 && x <= sc.clientWidth, dansLePremierTiers: x <= sc.clientWidth / 3 };
    });

    expect(etat.vue).toBe('semester');
    expect(etat.visible).toBe(true);
    expect(etat.dansLePremierTiers).toBe(true);
});

// La grille et les barres doivent partager la meme echelle : l'en-tete pose une colonne par
// semaine, les barres et la ligne du jour se placent en pixels par jour. Si la plage ne couvre pas
// un nombre entier de semaines, les deux derivent et le jour ne tombe plus dans sa colonne.
for (const jours of [0, 400]) {
    test('la ligne du jour tombe dans la colonne de la semaine courante' + (jours ? ', plage etendue par une tache ancienne' : ''), async ({ page }) => {
        const doc = D.documentCible();
        if (jours) doc.Tasks.records.push({ id: 7, titre: 'Historique', chantier: 1, dateDebut: D.j(-jours), dateEcheance: D.j(-jours + 70), statut: 'done', type: 'tache', priorite: '3' });
        await D.ouvrirGantt(page, doc);
        await D.attendreRendu(page);

        const dans = await page.evaluate(() => {
            const trait = document.querySelector('#timelineGrid .today-line').getBoundingClientRect();
            const colonne = document.querySelector('#timelineHeader .day-cell.today');
            if (!colonne) return null;
            const c = colonne.getBoundingClientRect();
            return trait.left >= c.left - 1 && trait.left <= c.right + 1;
        });

        expect(dans).toBe(true);
    });
}

test('une tâche ancienne est dessinée dans la plage, sans décaler l ouverture', async ({ page }) => {
    const doc = D.documentCible();
    doc.Tasks.records.push({ id: 7, titre: 'Historique', chantier: 1, dateDebut: D.j(-400), dateEcheance: D.j(-330), statut: 'done', type: 'tache', priorite: '3' });
    await D.ouvrirGantt(page, doc);
    await D.toutDeplier(page);

    const barre = page.locator('#timelineGrid .gantt-bar[data-id="7"]');
    await expect(barre).toHaveCount(1);
    expect(await barre.evaluate((el) => parseFloat(el.style.left))).toBeGreaterThanOrEqual(0);
    await expect.poll(() => ecartAuCalage(page)).toBeCloseTo(0, 0);
});

test('les libellés de mois sont centrés dans la hauteur de leur case', async ({ page }) => {
    await D.ouvrirGantt(page);

    const ecarts = await page.evaluate(() => Array.from(document.querySelectorAll('#monthsHeader .month-cell'))
        .filter((c) => c.textContent.trim())
        .map((c) => {
            const boite = c.getBoundingClientRect();
            const plage = document.createRange();
            plage.selectNodeContents(c);
            const texte = plage.getBoundingClientRect();
            return Math.abs((texte.top - boite.top) - (boite.bottom - texte.bottom));
        }));
    expect(ecarts.length).toBeGreaterThan(0);
    for (const ecart of ecarts) expect(ecart).toBeLessThanOrEqual(1.5);
});

test('un mois s écrit en entier quand sa case le permet, abrégé sinon', async ({ page }) => {
    await D.ouvrirGantt(page);
    await choisirVue(page, 'semester');

    // Comparés aux constantes du widget : le test ne dépend pas du mois courant.
    const libelles = await page.evaluate(() => Array.from(document.querySelectorAll('#monthsHeader .month-cell'))
        .filter((c) => c.textContent.trim())
        .map((c) => {
            const texte = c.textContent.trim();
            const nom = texte.includes(' · ') ? texte.split(' · ')[1] : texte;
            return { nom, largeur: c.getBoundingClientRect().width, complet: MONTHS.includes(nom), abrege: MONTHS_SHORT.includes(nom) };
        }));

    const larges = libelles.filter((l) => l.largeur > 100);
    expect(larges.length).toBeGreaterThan(2);
    for (const l of larges) expect(l.complet, l.nom).toBe(true);
    // Une case étroite en bord de plage reste lisible plutôt que tronquée.
    for (const l of libelles) expect(l.complet || l.abrege, l.nom).toBe(true);

    await choisirVue(page, 'year');
    const enVueAnnee = await page.evaluate(() => Array.from(document.querySelectorAll('#daysHeader .day-cell'))
        .map((c) => c.textContent.trim()).filter(Boolean).every((t) => MONTHS_SHORT.includes(t)));
    expect(enVueAnnee).toBe(true);
});

test('un jalon se déplace à la souris et garde une date unique', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.toutDeplier(page);
    const avant = await D.champTache(page, 4, 'dateDebut');

    const losange = page.locator('#timelineGrid .gantt-milestone').first();
    const boite = await losange.boundingBox();
    await page.mouse.move(boite.x + boite.width / 2, boite.y + boite.height / 2);
    await page.mouse.down();
    await page.mouse.move(boite.x + boite.width / 2 + 120, boite.y + boite.height / 2, { steps: 10 });
    await page.mouse.up();

    await expect.poll(() => D.champTache(page, 4, 'dateDebut')).toBeGreaterThan(avant);
    expect(await D.champTache(page, 4, 'dateEcheance')).toBe(await D.champTache(page, 4, 'dateDebut'));
});

// Naviguer réarmait le calage sur aujourd'hui : la fenêtre glissait bien, puis le défilement
// revenait se poser sur la sur-colonne du jour, et l'écran ne bougeait pas. Le besoin d'un
// réalignement portait sur le changement de vue temporelle, pas sur les flèches.
const jourAuBordGauche = (page) => page.evaluate(() => {
    const sc = document.getElementById('timelineScroll');
    const jours = sc.scrollLeft / effectivePxPerDay;
    return Math.round((effectiveStart.getTime() + jours * 86400000) / 86400000);
});

test('les fleches deplacent ce que la timeline montre', async ({ page }) => {
    await D.ouvrirGantt(page);
    await choisirVue(page, 'semester');
    const depart = await jourAuBordGauche(page);

    await page.locator('.btn-nav').last().click();
    await D.attendreRendu(page);

    expect(await jourAuBordGauche(page)).toBeGreaterThan(depart + 20);
});

test('changer de vue temporelle recale sur le jour', async ({ page }) => {
    await D.ouvrirGantt(page);
    await choisirVue(page, 'year');

    await choisirVue(page, 'semester');

    await expect.poll(() => ecartAuCalage(page)).toBeCloseTo(0, 0);
});
