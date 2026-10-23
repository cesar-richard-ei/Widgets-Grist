'use strict';

const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

// Le bandeau de domaine d'un chantier est une bande à part, au-dessus de sa ligne : la ligne
// grandit d'autant, à gauche comme sur la timeline, et rien ne déborde sur la ligne suivante.

const documentAvecLiens = () => D.avecLiens(D.documentCible(), {
    'Guide de prise en main': { debut: ['Analyse Plateforme Applicative et Cartographie des Usages'] }
});

async function ouvrirToutDeplie(page) {
    await D.ouvrirGantt(page, documentAvecLiens());
    await D.toutDeplier(page);
}

test('le bandeau de domaine a 6 px de marge en haut et en bas', async ({ page }) => {
    await ouvrirToutDeplie(page);

    const bandeau = D.ligne(page, 'Socle technique').locator('.bandeau-domaine');
    await expect(bandeau).toHaveCSS('padding-top', '6px');
    await expect(bandeau).toHaveCSS('padding-bottom', '6px');
    await expect(bandeau).toHaveCSS('height', '24px');
});

test('chaque ligne de gauche a la hauteur et la position de sa piste', async ({ page }) => {
    await ouvrirToutDeplie(page);

    const ecarts = await page.evaluate(() => {
        const gauche = Array.from(document.querySelectorAll('#taskList > div'));
        const droite = Array.from(document.querySelectorAll('#timelineGrid .grid-row'));
        const origineG = gauche[0].getBoundingClientRect().top;
        const origineD = droite[0].getBoundingClientRect().top;
        return gauche.map((l, i) => {
            const a = l.getBoundingClientRect(), b = droite[i].getBoundingClientRect();
            return Math.abs(a.height - b.height) + Math.abs((a.top - origineG) - (b.top - origineD));
        });
    });

    expect(ecarts.length).toBeGreaterThan(3);
    ecarts.forEach((e) => expect(e).toBeLessThan(1));
});

test('le contenu d une ligne de chantier reste sous son bandeau et dans sa ligne', async ({ page }) => {
    await ouvrirToutDeplie(page);

    const mesure = await D.ligne(page, 'Socle technique').evaluate((ligne) => {
        const r = ligne.getBoundingClientRect();
        const bandeau = ligne.querySelector('.bandeau-domaine').getBoundingClientRect();
        const info = ligne.querySelector('.task-info').getBoundingClientRect();
        const suivante = ligne.nextElementSibling.getBoundingClientRect();
        return { sousBandeau: info.top - bandeau.bottom, dansLigne: r.bottom - info.bottom, jointure: suivante.top - r.bottom };
    });

    expect(mesure.sousBandeau).toBeGreaterThanOrEqual(0);
    expect(mesure.dansLigne).toBeGreaterThanOrEqual(0);
    expect(Math.abs(mesure.jointure)).toBeLessThan(1);
});

test('chaque barre est centree dans sa ligne, sous le bandeau', async ({ page }) => {
    await ouvrirToutDeplie(page);

    const ecarts = await page.evaluate(() => {
        const pistes = Array.from(document.querySelectorAll('#timelineGrid .grid-row'));
        const lignes = Array.from(document.querySelectorAll('#taskList > div'));
        return Array.from(document.querySelectorAll('#timelineGrid .gantt-bar')).map((barre) => {
            const rang = lignes.findIndex((l) => l.dataset.id === barre.dataset.id);
            const piste = pistes[rang].getBoundingClientRect();
            const bandeau = pistes[rang].classList.contains('avec-domaine') ? 24 : 0;
            const b = barre.getBoundingClientRect();
            const centreAttendu = piste.top + bandeau + (piste.height - bandeau) / 2;
            return Math.abs((b.top + b.height / 2) - centreAttendu);
        });
    });

    expect(ecarts.length).toBeGreaterThan(3);
    ecarts.forEach((e) => expect(e).toBeLessThan(2));
});

test('une fleche de dependance arrive au centre de la barre qui suit', async ({ page }) => {
    await ouvrirToutDeplie(page);

    const ecart = await page.evaluate(() => {
        const trait = document.querySelector('.dependencies-layer .dependency-line');
        const fin = trait.getAttribute('d').trim().split(/[ ,]/).slice(-1)[0];
        const id = Array.from(document.querySelectorAll('#taskList > div'))
            .find((l) => l.innerText.includes('Guide de prise en main')).dataset.id;
        const barre = document.querySelector('#timelineGrid .gantt-bar[data-id="' + id + '"]');
        const grille = document.getElementById('timelineGrid').getBoundingClientRect();
        const b = barre.getBoundingClientRect();
        return Math.abs(parseFloat(fin) - ((b.top - grille.top) + b.height / 2));
    });

    expect(ecart).toBeLessThan(2);
});

// Filtré par domaine, le Gantt ne montre que ce domaine : son liseret coiffe chaque projet une fois,
// au-dessus de son nom, au lieu de se répéter sur chaque chantier.

const filtrer = (page, ...domaines) => page.evaluate((ds) => ds.forEach((d) => toggleFilter('domaine', d)), domaines);
const liserets = (page, projet) => page.locator('#taskList .groupe-projet', { hasText: projet }).locator('.bandeau-domaine');

test('filtre par domaine : le liseret coiffe le projet une seule fois', async ({ page }) => {
    await ouvrirToutDeplie(page);
    await filtrer(page, 'Socle technique');

    await expect(page.locator('#taskList .task-row .bandeau-domaine')).toHaveCount(0);
    await expect(liserets(page, 'Portail habilitations')).toHaveText(['Socle technique']);

    const ecart = await page.locator('#taskList .groupe-projet', { hasText: 'Portail habilitations' }).evaluate((g) =>
        g.querySelector('.groupe-nom').getBoundingClientRect().top - g.querySelector('.bandeau-domaine').getBoundingClientRect().bottom);
    expect(ecart).toBeGreaterThanOrEqual(0);
});

test('filtre sur deux domaines : un liseret par domaine qui touche le projet', async ({ page }) => {
    await ouvrirToutDeplie(page);
    await filtrer(page, 'Socle technique', 'Expérience');

    await expect(liserets(page, 'Portail habilitations')).toHaveText(['Expérience', 'Socle technique']);
    await expect(liserets(page, 'Datalab')).toHaveText(['Expérience']);
});

test('filtre par domaine : chaque ligne de gauche garde la hauteur et la position de sa piste', async ({ page }) => {
    await ouvrirToutDeplie(page);
    await filtrer(page, 'Socle technique', 'Expérience');
    await D.toutDeplier(page);

    const ecarts = await page.evaluate(() => {
        const gauche = Array.from(document.querySelectorAll('#taskList > div'));
        const droite = Array.from(document.querySelectorAll('#timelineGrid .grid-row'));
        const origineG = gauche[0].getBoundingClientRect().top;
        const origineD = droite[0].getBoundingClientRect().top;
        return gauche.map((l, i) => {
            const a = l.getBoundingClientRect(), b = droite[i].getBoundingClientRect();
            return Math.abs(a.height - b.height) + Math.abs((a.top - origineG) - (b.top - origineD));
        });
    });

    expect(ecarts.length).toBeGreaterThan(3);
    ecarts.forEach((e) => expect(e).toBeLessThan(1));
});
