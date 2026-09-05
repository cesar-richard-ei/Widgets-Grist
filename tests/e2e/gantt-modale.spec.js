'use strict';

const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

// Le widget pose ses propres questions. Un dialogue du navigateur s'ouvre au nom du domaine qui
// sert le widget, au milieu d'une page qui n'est pas la sienne, et n'offre que deux réponses, dont
// un « Annuler » auquel il fallait accrocher le détachement des sous-tâches.

const modale = (page) => page.locator('#modaleChoix');
const bouton = (page, libelle) => modale(page).locator('button', { hasText: libelle });

const ouvrirSuppression = async (page, titre) => {
    await D.ouvrirVolet(page, titre);
    await page.locator('#panel .panel-btn.danger', { hasText: 'Supprimer' }).click();
    await page.locator('#deleteConfirm .delete-confirm-btn.confirm').click();
};

const identifiants = (page) => page.evaluate(async () => (await window.grist.docApi.fetchTable('Tasks')).id);

test('aucun dialogue du navigateur ne s ouvre', async ({ page }) => {
    const natifs = [];
    page.on('dialog', (d) => { natifs.push(d.message()); d.dismiss(); });
    await D.ouvrirGantt(page);
    await D.deplier(page, 'Socle technique', 'Cadrage des outils');

    await ouvrirSuppression(page, 'Cadrage des outils');

    await expect(modale(page)).toBeVisible();
    expect(natifs).toEqual([]);
});

test('supprimer une tache parente propose de detacher ou de tout supprimer', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.deplier(page, 'Socle technique', 'Cadrage des outils');

    await ouvrirSuppression(page, 'Cadrage des outils');

    await expect(bouton(page, 'Tout supprimer')).toBeVisible();
    await expect(bouton(page, 'Détacher')).toBeVisible();
    await expect(bouton(page, 'Annuler')).toBeVisible();
});

test('detacher retire le parent et laisse les sous-taches', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.deplier(page, 'Socle technique', 'Cadrage des outils');
    const avant = await identifiants(page);

    await ouvrirSuppression(page, 'Cadrage des outils');
    await bouton(page, 'Détacher').click();

    await expect.poll(() => identifiants(page)).toHaveLength(avant.length - 1);
    await expect(page.locator('#taskList')).toContainText('Atelier de cadrage');
});

test('tout supprimer emporte la branche entiere', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.deplier(page, 'Socle technique', 'Cadrage des outils');
    const avant = await identifiants(page);

    await ouvrirSuppression(page, 'Cadrage des outils');
    await bouton(page, 'Tout supprimer').click();

    await expect.poll(() => identifiants(page)).toHaveLength(avant.length - 2);
    await expect(page.locator('#taskList')).not.toContainText('Atelier de cadrage');
});

test('annuler ne supprime rien', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.deplier(page, 'Socle technique', 'Cadrage des outils');
    const avant = await identifiants(page);

    await ouvrirSuppression(page, 'Cadrage des outils');
    await bouton(page, 'Annuler').click();

    await expect(modale(page)).not.toBeVisible();
    expect(await identifiants(page)).toEqual(avant);
});

// Demander une table que le document ne porte pas fait journaliser une erreur par Grist, avant même
// que notre garde ne la voie : une ligne rouge à chaque ouverture.
test('une table absente du schema n est pas demandee', async ({ page }) => {
    const doc = D.documentCible();
    delete doc.Categorie_de_projet;
    doc.Projects.columns.Categorie = { type: 'Choice' };
    await page.addInitScript(() => {
        window.__lectures = [];
        const armer = setInterval(() => {
            if (!window.grist || !window.grist.docApi || window.grist.docApi.__suivi) return;
            const vraie = window.grist.docApi.fetchTable.bind(window.grist.docApi);
            window.grist.docApi.fetchTable = (nom) => { window.__lectures.push(nom); return vraie(nom); };
            window.grist.docApi.__suivi = true;
            clearInterval(armer);
        }, 1);
    });

    await D.ouvrirGantt(page, doc);

    expect(await page.evaluate(() => window.__lectures)).not.toContain('Categorie_de_projet');
});
