'use strict';

const { test, expect } = require('./harness.js');

// Viewport etroit pour forcer le depassement horizontal de la timeline.
test.use({ viewport: { width: 720, height: 640 } });

const scrollLeft = (sc) => sc.evaluate((el) => el.scrollLeft);

// Position de la ligne « aujourd'hui » dans la zone visible : marge a gauche et largeur
// de la zone, en px. Lues en une seule passe, la timeline etant reconstruite a chaque
// rendu : deux mesures separees peuvent tomber de part et d'autre.
function mesure(page) {
    return page.evaluate(() => {
        const sc = document.getElementById('timelineScroll');
        const line = document.querySelector('#timelineGrid .today-line');
        if (!sc || !line) return null;
        return { marge: parseInt(line.style.left, 10) - sc.scrollLeft, visible: sc.clientWidth };
    });
}

// Depassement du premier tiers visible, en px : negatif tant que la ligne y reste.
// Le defilement se pose en px entiers, un pixel de jeu ne signifie rien a l'ecran.
async function depassementDuTiers(page) {
    const m = await mesure(page);
    return m ? m.marge - m.visible / 3 : null;
}

// Ecart entre le calage obtenu et celui vise, en colonnes : le debut de la sur-colonne qui
// contient la ligne du jour vient au bord gauche avec un ecart de 12px, borne au premier tiers
// visible et au defilement disponible. Obtenu et vise sont lus dans la meme passe, pour la
// raison donnee sur mesure(). En colonnes, la largeur de colonne suivant celle de la fenetre.
// Un seuil fixe ne tiendrait pas : la marge croit avec le jour du mois, la sur-colonne visee
// etant le mois courant.
function ecartAuCalage(page) {
    return page.evaluate(() => {
        const sc = document.getElementById('timelineScroll');
        const line = document.querySelector('#timelineGrid .today-line');
        if (!sc || !line) return null;

        const ligne = parseInt(line.style.left, 10);
        const colonne = document.querySelector('#timelineHeader .day-cell').getBoundingClientRect().width;

        let debutSurColonne = 0;
        for (let x = 0, cellules = document.querySelectorAll('#timelineHeader .month-cell'), i = 0; i < cellules.length; i++) {
            const largeur = parseFloat(cellules[i].style.width);
            if (ligne < x + largeur) { debutSurColonne = x; break; }
            x += largeur;
        }

        const vise = Math.max(debutSurColonne - 12, ligne - sc.clientWidth / 3);
        const defilement = Math.min(Math.max(vise, 0), sc.scrollWidth - sc.clientWidth);
        return (defilement - sc.scrollLeft) / colonne;
    });
}

test("a l'ouverture, la ligne du jour est calee pres du bord gauche", async ({ gantt }) => {
    await expect.poll(() => ecartAuCalage(gantt)).toBeCloseTo(0, 0);
});

// Une colonne = un jour : caler le 1er du mois laisse autant de colonnes que de jours ecoules,
// la ou caler la colonne du jour collerait la ligne au bord.
test('vue Mois : le calage vise le debut du mois, pas la colonne du jour', async ({ gantt }) => {
    await gantt.locator('.view-controls .btn[data-view="month"]').click();
    await expect.poll(() => ecartAuCalage(gantt)).toBeCloseTo(0, 0);
});

test("le bouton Aujourd'hui recale la vue", async ({ gantt }) => {
    const sc = gantt.locator('#timelineScroll');
    await sc.evaluate((el) => { el.scrollLeft = 250; });
    expect(await scrollLeft(sc)).toBeGreaterThan(0);

    await gantt.locator('button:has-text("Aujourd")').click();
    await expect.poll(() => ecartAuCalage(gantt)).toBeCloseTo(0, 0);
});

test("changer d'echelle de vue recale", async ({ gantt }) => {
    const sc = gantt.locator('#timelineScroll');
    await sc.evaluate((el) => { el.scrollLeft = 250; });
    const avant = await scrollLeft(sc);

    await gantt.locator('.view-controls .btn[data-view="year"]').click();
    await expect.poll(() => scrollLeft(sc)).not.toBe(avant);
    await expect.poll(() => depassementDuTiers(gantt)).toBeLessThanOrEqual(1);
});

// La sur-colonne peut couvrir un mois entier (vue Mois) ou une annee entiere (vue Annee) :
// caler son debut au bord gauche envoie alors la ligne « aujourd'hui » loin dans la timeline,
// jusqu'a la sortir de la zone visible. La marge est bornee au premier tiers visible.
for (const vue of ['month', 'quarter', 'semester', 'year']) {
    test('vue ' + vue + " : aujourd'hui reste dans le premier tiers visible", async ({ gantt }) => {
        await gantt.locator('.view-controls .btn[data-view="' + vue + '"]').click();

        await expect.poll(() => depassementDuTiers(gantt)).toBeLessThanOrEqual(1);
        expect((await mesure(gantt)).marge).toBeGreaterThanOrEqual(0);
    });
}

// Trimestre et semestre tiennent entierement dans une fenetre large : aucun defilement n'est
// disponible, donc seule la plage affichee peut ramener la ligne du jour au bord. Elle demarre
// au mois courant, et non au debut du trimestre ou du semestre calendaire.
test.describe('plage glissante', () => {
    test.use({ viewport: { width: 1680, height: 900 } });

    for (const vue of ['quarter', 'semester']) {
        test('vue ' + vue + " : la ligne du jour reste pres du bord", async ({ gantt }) => {
            await gantt.locator('.view-controls .btn[data-view="' + vue + '"]').click();
            await expect.poll(() => ecartAuCalage(gantt)).toBeCloseTo(0, 0);
        });
    }

    test('la navigation avance mois par mois en semestre', async ({ gantt }) => {
        await gantt.locator('.view-controls .btn[data-view="semester"]').click();
        const libelle = gantt.locator('#currentPeriod');
        const avant = await libelle.textContent();

        await gantt.locator('.btn-nav[onclick="navigate(1)"]').click();

        await expect.poll(() => libelle.textContent()).not.toBe(avant);
        // Le libelle couvre la plage affichee, donc deux mois : « Aou 2026 - Jan 2027 ».
        expect(await libelle.textContent()).toContain('-');
    });
});

test.describe('fenetre large', () => {
    test.use({ viewport: { width: 1680, height: 900 } });

    test("la timeline qui tient a l'ecran garde aujourd'hui visible", async ({ gantt }) => {
        await expect.poll(async () => { const m = await mesure(gantt); return m.marge - m.visible; }).toBeLessThan(0);
    });

    test("vue Mois sur ecran large : aujourd'hui reste dans la zone visible", async ({ gantt }) => {
        await gantt.locator('.view-controls .btn[data-view="month"]').click();
        await expect.poll(async () => { const m = await mesure(gantt); return m.marge - m.visible; }).toBeLessThan(0);
    });
});
