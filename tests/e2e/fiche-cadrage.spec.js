'use strict';

const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

// Les blocs de la maquette des fiches : cadrage, chiffres clés, visuel et commentaire du statut.
// Les colonnes n'ont pas d'identifiant arrêté dans les documents : la fiche les reconnaît à leur
// libellé, et n'affiche rien d'un champ dont le document n'a pas la colonne.

const fiche = (page) => page.locator('.fiche');
const DATALAB = 2;

const COLONNES_MAQUETTE = {
    Objectif_principales_fonctionnalites: { type: 'Text', label: 'Objectif / principales fonctionnalités' },
    Public_cible: { type: 'Text', label: 'Public cible' },
    Contraintes_et_cadre: { type: 'Text', label: 'Contraintes et cadre' },
    Perimetre_donnees: { type: 'Text', label: 'Périmètre données' },
    Modalites_de_realisation: { type: 'Text', label: 'Modalités de réalisation' },
    Maturite: { type: 'Text', label: 'Maturité' },
    Commentaires_sur_le_statut: { type: 'Text', label: 'Commentaires sur le statut' },
    Visuel: { type: 'Attachments', label: 'Visuel' },
    Titre_du_visuel: { type: 'Text', label: 'Titre du visuel' },
    Indicateur_1: { type: 'Text', label: 'Indicateur 1' }, Donnee_indicateur_1: { type: 'Text', label: 'Donnée indicateur 1' },
    Indicateur_2: { type: 'Text', label: 'Indicateur 2' }, Donnee_indicateur_2: { type: 'Text', label: 'Donnée indicateur 2' },
    Indicateur_3: { type: 'Text', label: 'Indicateur 3' }, Donnee_indicateur_3: { type: 'Text', label: 'Donnée indicateur 3' }
};

function documentMaquette(categorie, valeurs) {
    const doc = D.documentCible();
    Object.assign(doc.Projects.columns, JSON.parse(JSON.stringify(COLONNES_MAQUETTE)));
    doc.Projects.columns.Statut = { type: 'Choice' };
    const p = doc.Projects.records.find((r) => r.id === DATALAB);
    p.Categorie = categorie;
    Object.assign(p, { Statut: 'En réalisation' }, valeurs || {});
    return doc;
}

const libelles = (page) => fiche(page).locator('.fiche-cadrage .fiche-label').allTextContents();

test('la fiche projet porte objectif, cible, contraintes et maturite', async ({ page }) => {
    await D.ouvrirFiche(page, documentMaquette(2, {
        Objectif_principales_fonctionnalites: 'Explorer les données', Public_cible: 'Chercheurs', Maturite: 'En construction'
    }), DATALAB);

    await expect(fiche(page).locator('.bloc-objectif textarea')).toHaveValue('Explorer les données');
    await expect(fiche(page).locator('.bloc-cible textarea')).toHaveValue('Chercheurs');
    await expect(fiche(page).locator('.bloc-contraintes textarea')).toHaveValue('');
    await expect(fiche(page).locator('.bloc-maturite textarea')).toHaveValue('En construction');
    const vus = await libelles(page);
    expect(vus).not.toContain('Périmètre données');
    expect(vus).not.toContain('Modalités de réalisation');
});

test('la maturite se range dans la colonne de gauche, sous les personnes', async ({ page }) => {
    await D.ouvrirFiche(page, documentMaquette(2, { Maturite: 'En construction' }), DATALAB);

    const gauche = fiche(page).locator('.fiche-cadrage > .fiche-colonne').first();
    await expect(gauche.locator('.fiche-bloc').last()).toHaveClass(/bloc-maturite/);
});

test('l offre de service ajoute perimetre donnees et modalites de realisation', async ({ page }) => {
    await D.ouvrirFiche(page, documentMaquette(3, { Perimetre_donnees: 'Entrepôt', Modalites_de_realisation: 'Guichet' }), DATALAB);

    await expect(fiche(page).locator('.bloc-perimetre textarea')).toHaveValue('Entrepôt');
    await expect(fiche(page).locator('.bloc-modalites textarea')).toHaveValue('Guichet');
});

test('un champ de cadrage s enregistre au depart du curseur', async ({ page }) => {
    await D.ouvrirFiche(page, documentMaquette(2), DATALAB);

    await fiche(page).locator('.bloc-objectif textarea').fill('Mettre un bac à sable à disposition');
    await fiche(page).locator('.bloc-objectif textarea').blur();

    await expect.poll(() => page.evaluate(async () => {
        const p = await window.grist.docApi.fetchTable('Projects');
        return p.Objectif_principales_fonctionnalites[p.id.indexOf(2)];
    })).toBe('Mettre un bac à sable à disposition');
});

test('sans les colonnes, la fiche ne montre aucun de ces blocs', async ({ page }) => {
    await D.ouvrirFiche(page, null, DATALAB);

    await expect(fiche(page).locator('.bloc-objectif, .bloc-cible, .bloc-maturite, .fiche-indicateurs, .bloc-visuel, .fiche-statut-aide')).toHaveCount(0);
});

test('les chiffres cles s affichent en haut de la colonne de droite d un produit', async ({ page }) => {
    const doc = documentMaquette(1, {
        Indicateur_1: 'utilisateurs', Donnee_indicateur_1: '800',
        Indicateur_2: 'requêtes', Donnee_indicateur_2: '10 000',
        Indicateur_3: '', Donnee_indicateur_3: ''
    });
    await D.ouvrirFiche(page, doc, DATALAB);

    const chiffres = fiche(page).locator('.fiche-indicateur');
    await expect(chiffres).toHaveCount(2);
    await expect(chiffres.nth(0).locator('.fiche-indicateur-valeur')).toHaveText('800');
    await expect(chiffres.nth(0).locator('.fiche-indicateur-libelle')).toHaveText('utilisateurs');
    await expect(chiffres.nth(1).locator('.fiche-indicateur-valeur')).toHaveText('10 000');
    const droite = fiche(page).locator('.fiche-cadrage > .fiche-colonne.droite');
    await expect(droite.locator('> *').first()).toHaveClass(/fiche-indicateurs/);
});

test('une fiche projet n affiche pas de chiffres cles', async ({ page }) => {
    await D.ouvrirFiche(page, documentMaquette(2, { Indicateur_1: 'utilisateurs', Donnee_indicateur_1: '800' }), DATALAB);

    await expect(fiche(page).locator('.fiche-indicateurs')).toHaveCount(0);
});

test('le visuel s affiche avec son titre dans la colonne de droite', async ({ page }) => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    let demande = '';
    await page.route('**/__grist/attachments/**', (route) => {
        demande = route.request().url();
        return route.fulfill({ status: 200, contentType: 'image/png', body: png });
    });
    await D.ouvrirFiche(page, documentMaquette(2, { Visuel: ['L', 7], Titre_du_visuel: 'Architecture cible' }), DATALAB);

    const visuel = fiche(page).locator('.fiche-colonne.droite .bloc-visuel');
    await expect(visuel.locator('.fiche-label')).toHaveText('Architecture cible');
    await expect(visuel.locator('img')).toHaveJSProperty('naturalWidth', 1);
    expect(demande).toContain('/attachments/7/download');
    expect(demande).toContain('auth=jeton-test');
});

test('sans visuel ni chiffres, la fiche garde ses deux colonnes', async ({ page }) => {
    await D.ouvrirFiche(page, documentMaquette(2), DATALAB);

    await expect(fiche(page).locator('.fiche-colonne.droite')).toHaveCount(0);
});

test('le commentaire du statut s affiche au survol du point d interrogation', async ({ page }) => {
    await D.ouvrirFiche(page, documentMaquette(2, { Commentaires_sur_le_statut: 'Recette décalée à novembre' }), DATALAB);

    const aide = fiche(page).locator('.bloc-statut .fiche-statut-aide');
    const bulle = fiche(page).locator('.bloc-statut .fiche-statut-bulle');
    await expect(aide).toHaveText('?');
    await expect(bulle).toBeHidden();
    await aide.hover();
    await expect(bulle).toBeVisible();
    await expect(bulle).toHaveText('Recette décalée à novembre');
});

test('sans commentaire, le statut n a pas de point d interrogation', async ({ page }) => {
    await D.ouvrirFiche(page, documentMaquette(2, { Commentaires_sur_le_statut: '' }), DATALAB);

    await expect(fiche(page).locator('.bloc-statut')).toBeVisible();
    await expect(fiche(page).locator('.fiche-statut-aide')).toHaveCount(0);
});

test('un produit garde sa fiche sans feuille de route', async ({ page }) => {
    await D.ouvrirFiche(page, documentMaquette(1), DATALAB);

    await expect(fiche(page).locator('.bloc-objectif')).toBeVisible();
    await expect(fiche(page).locator('.fiche-route')).toHaveCount(0);
});
