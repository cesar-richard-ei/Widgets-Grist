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

// Largeur d'une colonne de l'echelle courante, pour raisonner en colonnes plutot qu'en pixels :
// elle s'adapte a la largeur de la fenetre.
const largeurColonne = (page) => page.locator('#timelineHeader .day-cell').first()
    .evaluate((el) => el.getBoundingClientRect().width);

const margeEnColonnes = async (page) => {
    const m = await mesure(page);
    return m ? m.marge / (await largeurColonne(page)) : null;
};

test("a l'ouverture, la ligne du jour est calee pres du bord gauche", async ({ gantt }) => {
    await expect.poll(() => margeEnColonnes(gantt)).toBeLessThanOrEqual(1.5);
});

test('vue Mois : le calage vise le debut du mois, pas la colonne du jour', async ({ gantt }) => {
    await gantt.locator('.view-controls .btn[data-view="month"]').click();

    // Une colonne = un jour : caler le 1er du mois laisse autant de colonnes que de jours
    // ecoules, la ou caler la colonne du jour collerait la ligne au bord. Borne au premier
    // tiers visible, sinon la ligne sortirait de l'ecran en fin de mois.
    // Le calage laisse en plus un léger écart de 12px avant le début de la sur-colonne.
    const attendu = await gantt.evaluate(() => {
        const sc = document.getElementById('timelineScroll');
        const colonne = document.querySelector('#timelineHeader .day-cell').getBoundingClientRect().width;
        return (Math.min((new Date().getDate() - 1) * colonne, sc.clientWidth / 3) + 12) / colonne;
    });

    await expect.poll(() => margeEnColonnes(gantt)).toBeCloseTo(attendu, 0);
});

test("le bouton Aujourd'hui recale la vue", async ({ gantt }) => {
    const sc = gantt.locator('#timelineScroll');
    await sc.evaluate((el) => { el.scrollLeft = 250; });
    expect(await scrollLeft(sc)).toBeGreaterThan(0);

    await gantt.locator('button:has-text("Aujourd")').click();
    await expect.poll(() => margeEnColonnes(gantt)).toBeLessThanOrEqual(1.5);
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
        test('vue ' + vue + " : la ligne du jour reste a une colonne du bord", async ({ gantt }) => {
            await gantt.locator('.view-controls .btn[data-view="' + vue + '"]').click();
            await expect.poll(() => margeEnColonnes(gantt)).toBeLessThanOrEqual(1.5);
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
