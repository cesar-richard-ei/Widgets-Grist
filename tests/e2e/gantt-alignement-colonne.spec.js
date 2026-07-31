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

test("l'ouverture cale le debut du mois courant a gauche, pas la colonne du jour", async ({ gantt }) => {
    const sc = gantt.locator('#timelineScroll');

    // Aujourd'hui est dans le 1er mois du semestre courant : le debut de mois est deja au bord.
    await expect.poll(() => scrollLeft(sc)).toBe(0);

    // Du coup la ligne "aujourd'hui" n'est PAS collee au bord (elle est plus loin dans le mois) :
    // c'est la difference avec l'ancien comportement qui calait la colonne du jour.
    await expect.poll(async () => (await mesure(gantt)).marge).toBeGreaterThan(30);
});

test("le bouton Aujourd'hui recale la vue", async ({ gantt }) => {
    const sc = gantt.locator('#timelineScroll');
    await sc.evaluate((el) => { el.scrollLeft = 250; });
    expect(await scrollLeft(sc)).toBeGreaterThan(0);

    await gantt.locator('button:has-text("Aujourd")').click();
    await expect.poll(() => scrollLeft(sc)).toBe(0);
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
