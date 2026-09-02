'use strict';

const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

// Chaque projet ouvre sur un bandeau, dans la colonne de gauche comme sur la timeline. Il occupe
// une ligne entière : les barres étant posées à l'index de leur ligne, un bandeau qui n'aurait pas
// la sienne décalerait tout le Gantt.

const bandeaux = (page) => page.locator('#taskList .groupe-projet');
const bandeau = (page, nom) => bandeaux(page).filter({ hasText: nom });
const teinte = (page, nom) => bandeau(page, nom).evaluate((el) => getComputedStyle(el).backgroundImage);
const fond = (page, nom) => bandeau(page, nom).evaluate((el) => getComputedStyle(el).backgroundColor);

const rgb = (hex) => {
    const [, r, g, b] = /#(..)(..)(..)/.exec(hex);
    return [r, g, b].map((v) => parseInt(v, 16)).join(', ');
};

test('un bandeau ouvre chaque projet, avec son nom et sa catégorie', async ({ page }) => {
    await D.ouvrirGantt(page);

    await expect(bandeaux(page)).toHaveCount(2);
    await expect(bandeau(page, 'Portail habilitations')).toContainText('Produit');
    await expect(bandeau(page, 'Datalab')).toContainText('Projet');
});

test('sans table de catégories, le bandeau garde le nom du projet', async ({ page }) => {
    const doc = D.documentCible();
    delete doc.Categorie_de_projet;
    await D.ouvrirGantt(page, doc);

    await expect(bandeau(page, 'Portail habilitations')).toBeVisible();
});

test('le bandeau précède les lignes de son projet', async ({ page }) => {
    await D.ouvrirGantt(page);

    const libelles = await page.evaluate(() => Array.from(document.querySelectorAll('#taskList > div'))
        .map((l) => (l.classList.contains('groupe-projet') ? 'BANDEAU ' : 'LIGNE ') + l.innerText.replace(/\s+/g, ' ').trim()));
    expect(libelles[0]).toContain('BANDEAU');
    const rang = libelles.findIndex((l) => l.includes('Portail habilitations'));
    expect(libelles[rang + 1]).toContain('Socle technique');
});

test('replier un bandeau masque son projet et laisse les autres', async ({ page }) => {
    await D.ouvrirGantt(page);

    await bandeau(page, 'Portail habilitations').locator('.groupe-chevron').click();

    await expect(D.ligne(page, 'Socle technique')).toHaveCount(0);
    await expect(D.ligne(page, 'Guides utilisateurs')).toBeVisible();
});

test('la timeline garde une ligne en face de chaque ligne affichée', async ({ page }) => {
    await D.ouvrirGantt(page);

    const compte = await page.evaluate(() => ({
        gauche: document.querySelectorAll('#taskList > div').length,
        timeline: document.querySelectorAll('#timelineGrid .grid-row').length
    }));
    expect(compte.timeline).toBe(compte.gauche);

    await D.deplier(page, 'Socle technique', 'Cadrage des outils');
    const ecart = await page.evaluate(() => {
        const rang = Array.from(document.querySelectorAll('#taskList > div')).findIndex((l) => l.innerText.includes('Cadrage des outils'));
        const barre = document.querySelector('#timelineGrid .gantt-bar[data-id="1"]');
        return barre ? Math.abs(parseFloat(barre.style.top) - (rang * 44 + 10)) : null;
    });
    expect(ecart).toBeLessThan(1);
});

test('le bandeau porte la couleur du responsable du projet', async ({ page }) => {
    await D.ouvrirGantt(page);

    expect(await teinte(page, 'Portail habilitations')).toContain(rgb(D.COULEURS.vert));
    expect(await teinte(page, 'Datalab')).toContain(rgb(D.COULEURS.ocre));
});

test('sans responsable, la couleur du projet prend le relais', async ({ page }) => {
    const doc = D.documentCible();
    delete doc.Projects.records[0].responsable;
    await D.ouvrirGantt(page, doc);

    expect(await teinte(page, 'Portail habilitations')).toContain(rgb(D.COULEURS.bleu));
});

test('un responsable sans couleur laisse la main à celle du projet', async ({ page }) => {
    const doc = D.documentCible();
    doc.Team.records[1].couleur = '';
    await D.ouvrirGantt(page, doc);

    expect(await teinte(page, 'Portail habilitations')).toContain(rgb(D.COULEURS.bleu));
});

test('la teinte reste légère', async ({ page }) => {
    await D.ouvrirGantt(page);

    const alpha = parseFloat(/rgba\([^)]*,\s*([\d.]+)\)/.exec(await teinte(page, 'Portail habilitations'))[1]);
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(0.4);
});

// Deux bandeaux collés en haut se recouvrent au défilement : sans fond opaque, les deux titres se
// lisent l'un sur l'autre.
test('le bandeau masque ce qui défile dessous', async ({ page }) => {
    await D.ouvrirGantt(page);

    for (const nom of ['Portail habilitations', 'Datalab']) {
        expect(await fond(page, nom)).not.toContain('rgba');
    }
    const piste = await page.locator('#timelineGrid .grid-row.piste-groupe').first().evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(piste).not.toContain('rgba');
});

test('la bande de la timeline reprend la teinte et passe devant les barres', async ({ page }) => {
    await D.ouvrirGantt(page);

    const pistes = page.locator('#timelineGrid .grid-row.piste-groupe');
    await expect(pistes).toHaveCount(2);
    expect(await pistes.first().evaluate((el) => getComputedStyle(el).backgroundImage)).toContain(rgb(D.COULEURS.vert));

    const plans = await page.evaluate(() => {
        const lire = (sel) => parseInt(getComputedStyle(document.querySelector(sel)).zIndex, 10);
        return { piste: lire('#timelineGrid .grid-row.piste-groupe'), barre: lire('#timelineGrid .gantt-bar') };
    });
    expect(plans.piste).toBeGreaterThan(plans.barre);
});

test('aucun trait ne double la rupture entre deux projets', async ({ page }) => {
    await D.ouvrirGantt(page);

    await expect(page.locator('#taskList .debut-groupe')).toHaveCount(0);
    await expect(page.locator('#timelineGrid .debut-groupe')).toHaveCount(0);
});

test('le tri s applique à l intérieur de chaque projet', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.trier(page, 'date');

    const titres = await page.$$eval('#taskList .task-row', (l) => l.map((x) => x.textContent));
    const rang = (t) => titres.findIndex((x) => x.includes(t));
    expect(rang('Socle technique')).toBeLessThan(rang('Guides utilisateurs'));
});
