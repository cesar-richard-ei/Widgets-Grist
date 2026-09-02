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

// Le document du métier déduit certaines colonnes plutôt que de les saisir. La création posait
// Projets sans vérifier, Grist refusait le lot entier, et le formulaire restait ouvert sur un toast
// sans indice : c'est le « impossible de créer un chantier » remonté après la démonstration.
test('un chantier se crée même quand une colonne de sa table est calculée', async ({ page }) => {
    await D.ouvrirGantt(page, D.colonneCalculee(D.documentCible(), 'Chantiers', 'Projets'));

    await page.locator('#btnAjouter').click();
    await page.locator('#menuAjout button', { hasText: 'Chantier' }).click();
    await page.locator('#taskTitle').fill('Recette métier');
    await page.locator('#panel .panel-btn.success').click();

    await expect.poll(() => page.evaluate(async () => (await window.grist.docApi.fetchTable('Chantiers')).Nom_du_chantier)).toContain('Recette métier');
    await expect(page.locator('#panel')).not.toHaveClass(/open/);
});

test('un chantier s enregistre même quand une colonne de sa table est calculée', async ({ page }) => {
    await D.ouvrirGantt(page, D.colonneCalculee(D.documentCible(), 'Chantiers', 'Contributeurs'));
    await D.ouvrirVolet(page, 'Socle technique');

    await page.locator('#taskTitle').fill('Socle technique v2');
    await page.locator('#taskTitle').blur();

    await expect.poll(() => page.evaluate(async () => {
        const c = await window.grist.docApi.fetchTable('Chantiers');
        return c.Nom_du_chantier[c.id.indexOf(1)];
    })).toBe('Socle technique v2');
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

test('le volet d un chantier annonce que ses contributeurs remontent des tâches', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.ouvrirVolet(page, 'Socle technique');

    await expect(volet(page).locator('.prop-hint')).toHaveText('Remontée automatique des contributeurs aux tâches');
});

test('le volet d une tâche ne porte pas cette mention', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.deplier(page, 'Socle technique', 'Cadrage des outils');
    await D.ouvrirVolet(page, 'Cadrage des outils');

    await expect(volet(page).locator('.prop-hint')).toHaveCount(0);
});

// Les contributeurs d'un chantier sont une remontée de ses tâches : les écrire réécrirait la colonne
// à chaque enregistrement, et effacerait ce qui a été saisi dans Grist.
test('enregistrer un chantier laisse ses contributeurs intacts', async ({ page }) => {
    const doc = D.documentCible();
    doc.Chantiers.records.find((c) => c.id === 2).Contributeurs = ['L', 1];
    await D.ouvrirGantt(page, doc);
    await D.ouvrirVolet(page, 'Guides utilisateurs');

    await page.locator('#taskTitle').fill('Guides utilisateurs v2');
    await page.locator('#taskTitle').blur();

    await expect.poll(() => page.evaluate(async () => {
        const c = await window.grist.docApi.fetchTable('Chantiers');
        return c.Nom_du_chantier[c.id.indexOf(2)];
    })).toBe('Guides utilisateurs v2');

    const contributeurs = await page.evaluate(async () => {
        const c = await window.grist.docApi.fetchTable('Chantiers');
        return c.Contributeurs[c.id.indexOf(2)];
    });
    expect(contributeurs).toEqual(['L', 1]);
});

// Le document du métier nomme les dates d'un chantier Debut et Fin. Le widget écrivait Date_debut et
// Date_fin : pruneChantierRecord les élaguait, et aucune date de chantier ne partait en base.
const datesRenommees = () => D.renommerColonne(
    D.renommerColonne(D.documentCible(), 'Chantiers', 'Date_debut', 'Debut'),
    'Chantiers', 'Date_fin', 'Fin');

test('les dates d un chantier sont lues sous le nom que porte le document', async ({ page }) => {
    const doc = datesRenommees();
    const attendu = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);
    const chantier = doc.Chantiers.records.find((c) => c.id === 1);
    await D.ouvrirGantt(page, doc);
    await D.ouvrirVolet(page, 'Socle technique');

    // Le volet préremplit depuis les tâches quand la date manque : c'est la valeur du chantier,
    // distincte des bornes de ses tâches, qui dit que la colonne a bien été lue.
    const dates = volet(page).locator('input[type="date"]');
    await expect(dates.first()).toHaveValue(attendu(chantier.Debut));
    await expect(dates.nth(1)).toHaveValue(attendu(chantier.Fin));
});

test('modifier les dates d un chantier les ecrit sous ce meme nom', async ({ page }) => {
    await D.ouvrirGantt(page, datesRenommees());
    await D.ouvrirVolet(page, 'Socle technique');

    const dates = volet(page).locator('input[type="date"]');
    await dates.first().fill('2026-03-02');
    await dates.first().blur();

    await expect.poll(() => page.evaluate(async () => {
        const c = await window.grist.docApi.fetchTable('Chantiers');
        return c.Debut[c.id.indexOf(1)];
    })).toBe(Math.floor(Date.UTC(2026, 2, 2) / 1000));
});

// Le volet affiche un responsable de chantier sans jamais le lire ni l'écrire : la saisie disparaît
// au rechargement, derrière le même indicateur d'enregistrement que les champs qui aboutissent.
test('le volet d un chantier ouvre sur le responsable enregistré', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.ouvrirVolet(page, 'Socle technique');

    await expect(volet(page).locator('.resp-choisi')).toContainText('Bruno Klein');
});

test('choisir un responsable sur un chantier l ecrit dans sa table', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.ouvrirVolet(page, 'Guides utilisateurs');

    await volet(page).locator('#responsableSelect .addbtn').click();
    await volet(page).locator('#responsableSelect .multi-select-option', { hasText: 'David Sarr' }).click();

    await expect.poll(() => page.evaluate(async () => {
        const c = await window.grist.docApi.fetchTable('Chantiers');
        return c.Responsable[c.id.indexOf(2)];
    })).toBe(4);
});

test('creer un chantier avec un responsable l enregistre', async ({ page }) => {
    await D.ouvrirGantt(page);

    await page.locator('#btnAjouter').click();
    await page.locator('#menuAjout button', { hasText: 'Chantier' }).click();
    await page.locator('#taskTitle').fill('Recette métier');
    await volet(page).locator('#responsableSelect .addbtn').click();
    await volet(page).locator('#responsableSelect .multi-select-option', { hasText: 'Alice Martin' }).click();
    await page.locator('#panel .panel-btn.success').click();

    await expect.poll(() => page.evaluate(async () => {
        const c = await window.grist.docApi.fetchTable('Chantiers');
        return c.Responsable[c.Nom_du_chantier.indexOf('Recette métier')];
    })).toBe(1);
});

// Sans la colonne côté Chantiers, le champ n'a pas de destination : le laisser rendrait la saisie
// silencieusement inopérante, alors que les tâches gardent la leur.
test('sans la colonne sur Chantiers, le volet d un chantier ne propose pas de responsable', async ({ page }) => {
    await D.ouvrirGantt(page, D.sansColonne(D.documentCible(), 'Responsable', 'Chantiers'));
    await D.ouvrirVolet(page, 'Socle technique');
    await expect(volet(page).locator('#responsableSelect')).toHaveCount(0);

    await D.deplier(page, 'Socle technique', 'Cadrage des outils');
    await D.ouvrirVolet(page, 'Cadrage des outils');
    await expect(volet(page).locator('#responsableSelect')).toHaveCount(1);
});
