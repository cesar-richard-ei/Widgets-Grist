'use strict';

const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

// Le rattachement d'une tâche à son chantier se reconnaît au **type** de la colonne, jamais à son
// nom ni à sa valeur : les identifiants de Chantiers et de Tasks se recouvrent, et résoudre un
// parent dans la mauvaise table rattache des lignes sans rapport, sans que rien ne plante.
//
// Trois documents coexistent dans la nature, et les trois doivent tenir :
//   - modèle cible : une colonne dédiée, quel que soit son nom ;
//   - copie de travail : parentTask repointé vers Chantiers ;
//   - ancien modèle : pas de table Chantiers du tout.

const volet = (page) => page.locator('#panel');

test('le chantier tient le niveau 0, ses tâches le niveau 1', async ({ page }) => {
    await D.ouvrirGantt(page);

    await expect(D.ligne(page, 'Socle technique')).toHaveAttribute('data-depth', '0');
    await D.deplier(page, 'Socle technique', 'Cadrage des outils');
    await expect(D.ligne(page, 'Cadrage des outils')).toHaveAttribute('data-depth', '1');
});

test('une sous-tâche reste sous sa tâche, pas sous le chantier', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.toutDeplier(page);

    await expect(D.ligne(page, 'Atelier de cadrage')).toHaveAttribute('data-depth', '2');
});

test('le nom de la colonne de rattachement n a pas d importance', async ({ page }) => {
    await D.ouvrirGantt(page, D.documentCible('Chantiers'));

    await expect(D.ligne(page, 'Socle technique')).toHaveAttribute('data-depth', '0');
    await D.deplier(page, 'Socle technique', 'Cadrage des outils');
    await expect(D.ligne(page, 'Cadrage des outils')).toHaveAttribute('data-depth', '1');
});

test('sur la copie de travail, les tâches ne se rattachent pas entre elles', async ({ page }) => {
    await D.ouvrirGantt(page, D.documentParentRepointe());
    await D.toutDeplier(page);

    await expect(D.ligne(page, 'Socle technique')).toHaveAttribute('data-depth', '0');
    await expect(D.ligne(page, 'Cadrage des outils')).toHaveAttribute('data-depth', '1');
    await expect(D.ligne(page, 'Recette')).toHaveAttribute('data-depth', '1');
});

test('sans table Chantiers, la hiérarchie des tâches est conservée', async ({ page }) => {
    await D.ouvrirGantt(page, D.documentSansChantiers());
    await D.toutDeplier(page);

    await expect(D.ligne(page, 'Cadrage des outils')).toHaveAttribute('data-depth', '0');
    await expect(D.ligne(page, 'Atelier de cadrage')).toHaveAttribute('data-depth', '1');
    await expect(page.locator('#btnAjouter')).toBeVisible();
});

test('une tâche hérite du projet de son chantier', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.toutDeplier(page);

    // Aucune tâche ne porte de projet : celui du chantier fait foi, et le bandeau les regroupe.
    await expect(page.locator('#taskList .groupe-projet', { hasText: 'Portail habilitations' })).toHaveCount(1);
    await expect(page.locator('#taskList .groupe-projet', { hasText: 'Sans projet' })).toHaveCount(0);
});

test('le volet d un chantier s ouvre sur son nom, sans type modifiable', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.ouvrirVolet(page, 'Socle technique');

    await expect(page.locator('#taskTitle')).toHaveValue('Socle technique');
    await expect(volet(page).locator('.panel-type-row')).toContainText('Chantier');
    await expect(volet(page).locator('.type-pill[onclick]')).toHaveCount(0);
    await expect(volet(page)).toContainText('Ajouter une tâche');
});

test('un chantier sans dates prend celles de ses tâches', async ({ page }) => {
    const doc = D.documentCible();
    delete doc.Chantiers.records[0].Date_debut;
    delete doc.Chantiers.records[0].Date_fin;
    await D.ouvrirGantt(page, doc);
    await D.ouvrirVolet(page, 'Socle technique');

    const dates = volet(page).locator('input[type="date"]');
    await expect(dates.first()).not.toHaveValue('');
    await expect(dates.nth(1)).not.toHaveValue('');
});

test('modifier un chantier écrit dans sa table, pas dans Tasks', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.ouvrirVolet(page, 'Socle technique');

    await page.locator('#taskTitle').fill('Socle technique v2');
    await page.locator('#taskTitle').blur();

    await expect.poll(() => page.evaluate(async () => {
        const c = await window.grist.docApi.fetchTable('Chantiers');
        return c.Nom_du_chantier[c.id.indexOf(1)];
    })).toBe('Socle technique v2');

    // Les titres des tâches n'ont pas bougé : l'identifiant décalé d'un chantier ne désigne
    // aucun enregistrement de Tasks.
    const titres = await page.evaluate(async () => (await window.grist.docApi.fetchTable('Tasks')).titre);
    expect(titres).toContain('Cadrage des outils');
    expect(titres).not.toContain('Socle technique v2');
});

test('modifier une tâche ne réécrit pas son rattachement', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.deplier(page, 'Socle technique', 'Cadrage des outils');
    await D.ouvrirVolet(page, 'Cadrage des outils');

    await page.locator('#taskTitle').fill('Cadrage des outils v2');
    await page.locator('#taskTitle').blur();

    await expect.poll(() => D.champTache(page, 1, 'titre')).toBe('Cadrage des outils v2');
    expect(await D.champTache(page, 1, 'chantier')).toBe(1);
    expect(await D.champTache(page, 1, 'parentTask') || 0).toBe(0);
});

test('créer un chantier l ajoute à sa table, en ligne racine', async ({ page }) => {
    await D.ouvrirGantt(page);

    await page.locator('#btnAjouter').click();
    await page.locator('#menuAjout button', { hasText: 'Chantier' }).click();
    await page.locator('#taskTitle').fill('Recette métier');
    await page.locator('#panel .panel-btn.success').click();

    await expect.poll(() => page.evaluate(async () => (await window.grist.docApi.fetchTable('Chantiers')).Nom_du_chantier)).toContain('Recette métier');
    await expect(D.ligne(page, 'Recette métier')).toHaveAttribute('data-depth', '0');
});

for (const nomColonne of ['chantier', 'Chantiers']) {
    test('une tâche créée depuis un chantier est rattachée via la colonne ' + nomColonne, async ({ page }) => {
        await D.ouvrirGantt(page, D.documentCible(nomColonne));
        await D.ouvrirVolet(page, 'Socle technique');

        await page.locator('#panel button', { hasText: 'Ajouter une tâche' }).click();
        await page.locator('#taskTitle').fill('Nouvelle tâche');
        await page.locator('#panel .panel-btn.success').click();

        await expect.poll(() => page.evaluate(async (col) => {
            const t = await window.grist.docApi.fetchTable('Tasks');
            const i = t.titre.indexOf('Nouvelle tâche');
            return i === -1 ? null : t[col][i];
        }, nomColonne)).toBe(1);
    });
}
