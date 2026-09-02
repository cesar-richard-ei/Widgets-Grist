'use strict';

const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

// La structure réelle du document du métier, relevée sur la copie de qualification : le
// rattachement d'une tâche s'appelle `Chantier`, les dates d'un chantier `Debut` et `Fin`, et
// `Team.role` n'est renseigné sur personne, le domaine portant seul l'équipe de rattachement.
// Les modèles de référence nomment ces colonnes autrement : ce fichier vérifie que le widget
// suit la structure telle qu'elle est, sans nom en dur.

const DOMAINES = ['Design et Produits', 'Ingénierie et Sciences des Données', 'Socle et Architecture Technique', 'Innovation'];

function documentMetier() {
    let doc = D.documentCible('Chantier');
    doc = D.renommerColonne(doc, 'Chantiers', 'Date_debut', 'Debut');
    doc = D.renommerColonne(doc, 'Chantiers', 'Date_fin', 'Fin');
    doc.Team.records.forEach((m, i) => { m.role = ''; m.Domaine = DOMAINES[i]; });
    return doc;
}

const volet = (page) => page.locator('#panel');
const filtrer = (page, domaine) => page.evaluate((d) => toggleFilter('domaine', d), domaine);
const chantiers = (page) => page.evaluate(() => window.grist.docApi.fetchTable('Chantiers'));

test('le menu des filtres propose les domaines du document, sans role renseigné', async ({ page }) => {
    await D.ouvrirGantt(page, documentMetier());

    await page.locator('#filterGantt .filter-btn').click();

    for (const domaine of DOMAINES) {
        await expect(page.locator('#filterAllMenu')).toContainText(domaine);
    }
});

test('filtrer sur un domaine ne garde que ce qu il touche', async ({ page }) => {
    await D.ouvrirGantt(page, documentMetier());
    await D.toutDeplier(page);

    // Alice porte « Design et Produits » et n'est posée que sur des tâches du premier chantier.
    await filtrer(page, 'Design et Produits');

    await expect(D.ligne(page, 'Cadrage des outils')).toBeVisible();
    await expect(D.ligne(page, 'Guide de prise en main')).toHaveCount(0);
});

test('creer un chantier avec un responsable l ecrit sous les noms du metier', async ({ page }) => {
    await D.ouvrirGantt(page, documentMetier());

    await page.locator('#btnAjouter').click();
    await page.locator('#menuAjout button', { hasText: 'Chantier' }).click();
    await page.locator('#taskTitle').fill('Reprise des habilitations');
    await volet(page).locator('#responsableSelect .addbtn').click();
    await volet(page).locator('#responsableSelect .multi-select-option', { hasText: 'Alice Martin' }).click();
    await page.locator('#panel .panel-btn.success').click();

    await expect.poll(async () => {
        const c = await chantiers(page);
        const i = c.Nom_du_chantier.indexOf('Reprise des habilitations');
        return i < 0 ? null : { responsable: c.Responsable[i], debut: typeof c.Debut[i], fin: typeof c.Fin[i] };
    }).toEqual({ responsable: 1, debut: 'number', fin: 'number' });
});

test('le responsable d un chantier revient à la réouverture de son volet', async ({ page }) => {
    await D.ouvrirGantt(page, documentMetier());

    await D.ouvrirVolet(page, 'Guides utilisateurs');
    await volet(page).locator('#responsableSelect .addbtn').click();
    await volet(page).locator('#responsableSelect .multi-select-option', { hasText: 'David Sarr' }).click();

    await D.ouvrirVolet(page, 'Socle technique');
    await D.ouvrirVolet(page, 'Guides utilisateurs');

    await expect(volet(page).locator('.resp-choisi')).toContainText('David Sarr');
});

test('les contributeurs d un chantier restent une remontée de ses tâches', async ({ page }) => {
    await D.ouvrirGantt(page, documentMetier());

    await D.ouvrirVolet(page, 'Socle technique');

    await expect(volet(page)).toContainText('Remontée automatique des contributeurs aux tâches');
});
