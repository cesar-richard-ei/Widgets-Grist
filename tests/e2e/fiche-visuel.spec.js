'use strict';

const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

// Un clic sur le visuel l'ouvre en grand, où il se zoome et se déplace.

const DATALAB = 2;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="800">'
    + '<rect width="1600" height="800" fill="#3e5de7"/><circle cx="800" cy="400" r="200" fill="#fff"/></svg>';

const fiche = (page) => page.locator('.fiche');
const visuel = (page) => fiche(page).locator('.fiche-visuel-bouton');
const popup = (page) => page.locator('dialog.visionneuse');
const image = (page) => popup(page).locator('.visionneuse-image');
const scene = (page) => popup(page).locator('.visionneuse-scene');

function avecVisuel(titre) {
    const doc = D.documentCible();
    doc.Projects.columns.Visuel = { type: 'Attachments', label: 'Visuel' };
    doc.Projects.columns.Titre_du_visuel = { type: 'Text', label: 'Titre du visuel' };
    Object.assign(doc.Projects.records.find((p) => p.id === DATALAB), { Visuel: ['L', 7], Titre_du_visuel: titre || '' });
    return doc;
}

async function ouvrirAvecVisuel(page, titre) {
    await page.route('**/__grist/attachments/**', (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG }));
    await D.ouvrirFiche(page, avecVisuel(titre), DATALAB);
    await expect(visuel(page).locator('img')).toHaveJSProperty('naturalWidth', 1600);
}

async function ouvrirEnGrand(page) {
    await visuel(page).click();
    await expect(image(page)).toBeVisible();
}

// Échelle affichée de l'image et position de son coin, relatives à la scène.
const vue = (page) => page.evaluate(() => {
    const s = document.querySelector('.visionneuse-scene').getBoundingClientRect();
    const r = document.querySelector('.visionneuse-image').getBoundingClientRect();
    return { echelle: r.width / 1600, x: r.left - s.left, y: r.top - s.top, scene: { l: s.width, h: s.height } };
});

test('un clic ouvre le visuel en grand, ajuste a la fenetre et titre', async ({ page }) => {
    await ouvrirAvecVisuel(page, 'Architecture cible');
    await ouvrirEnGrand(page);

    await expect(popup(page).locator('.visionneuse-titre')).toHaveText('Architecture cible');
    const v = await vue(page);
    expect(Math.min(v.scene.l / 1600, v.scene.h / 800)).toBeCloseTo(v.echelle, 2);
    expect(v.x).toBeGreaterThanOrEqual(-0.5);
    expect(v.y).toBeGreaterThanOrEqual(-0.5);
});

test('echap ferme le visuel et rend le focus a la fiche', async ({ page }) => {
    await ouvrirAvecVisuel(page);
    await visuel(page).click();
    await expect(popup(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(popup(page)).toBeHidden();
    await expect(visuel(page)).toBeFocused();
});

test('un clic sur le fond ferme, un clic sur l image non', async ({ page }) => {
    await ouvrirAvecVisuel(page);
    await ouvrirEnGrand(page);

    await image(page).click();
    await expect(popup(page)).toBeVisible();
    await popup(page).locator('.visionneuse-fermer').click();
    await expect(popup(page)).toBeHidden();

    await ouvrirEnGrand(page);
    const v = await vue(page);
    await scene(page).click({ position: { x: 4, y: v.scene.h - 4 } });
    await expect(popup(page)).toBeHidden();
});

test('la molette zoome autour du pointeur, le glisser deplace, ajuster revient', async ({ page }) => {
    await ouvrirAvecVisuel(page);
    await ouvrirEnGrand(page);
    const depart = await vue(page);
    const boite = await scene(page).boundingBox();
    const point = { x: boite.x + depart.x + 400 * depart.echelle, y: boite.y + depart.y + 200 * depart.echelle };

    await page.mouse.move(point.x, point.y);
    await page.mouse.wheel(0, -400);
    await expect.poll(async () => (await vue(page)).echelle).toBeGreaterThan(depart.echelle * 1.5);
    const zoomee = await vue(page);
    expect(boite.x + zoomee.x + 400 * zoomee.echelle).toBeCloseTo(point.x, 0);
    expect(boite.y + zoomee.y + 200 * zoomee.echelle).toBeCloseTo(point.y, 0);

    await page.mouse.down();
    await page.mouse.move(point.x + 60, point.y + 30, { steps: 4 });
    await page.mouse.up();
    const deplacee = await vue(page);
    expect(deplacee.x - zoomee.x).toBeCloseTo(60, 0);
    expect(deplacee.y - zoomee.y).toBeCloseTo(30, 0);
    await expect(popup(page)).toBeVisible();

    await popup(page).getByRole('button', { name: 'Ajuster', exact: true }).click();
    expect(await vue(page)).toEqual(depart);
});

test('les boutons et le clavier zooment sans molette', async ({ page }) => {
    await ouvrirAvecVisuel(page);
    await ouvrirEnGrand(page);
    const depart = await vue(page);

    await popup(page).getByRole('button', { name: 'Zoomer', exact: true }).click();
    expect((await vue(page)).echelle).toBeGreaterThan(depart.echelle);
    await popup(page).getByRole('button', { name: 'Dézoomer', exact: true }).click();
    expect((await vue(page)).echelle).toBeCloseTo(depart.echelle, 5);

    await page.keyboard.press('+');
    expect((await vue(page)).echelle).toBeGreaterThan(depart.echelle);
    await page.keyboard.press('0');
    expect(await vue(page)).toEqual(depart);
});

test('un double clic agrandit puis revient a l image ajustee', async ({ page }) => {
    await ouvrirAvecVisuel(page);
    await ouvrirEnGrand(page);
    const depart = await vue(page);

    await image(page).dblclick();
    expect((await vue(page)).echelle).toBeCloseTo(depart.echelle * 2, 5);
    await scene(page).dblclick();
    expect(await vue(page)).toEqual(depart);
    await expect(popup(page)).toBeVisible();
});

test('une relecture de la fiche laisse le visuel ouvert', async ({ page }) => {
    await ouvrirAvecVisuel(page);
    await visuel(page).click();
    await expect(popup(page)).toBeVisible();

    await page.evaluate(() => window.grist.docApi.applyUserActions([['UpdateRecord', 'Projects', 2, { nom: 'Datalab 2' }]]));
    await expect(fiche(page).locator('.fiche-titre')).toHaveText('Datalab 2');
    await expect(popup(page)).toBeVisible();
});

test('une fiche sans visuel n a rien a agrandir', async ({ page }) => {
    await D.ouvrirFiche(page, null, DATALAB);
    await expect(fiche(page).locator('.fiche-cadrage')).toBeVisible();
    await expect(visuel(page)).toHaveCount(0);
    await expect(popup(page)).toHaveCount(0);
});
