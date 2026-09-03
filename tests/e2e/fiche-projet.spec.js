'use strict';

const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

// La fiche d'un projet : son cadrage en en-tête, puis la feuille de route de ses chantiers.
// Lecture seule, liée à l'enregistrement sélectionné dans Projects.

const fiche = (page) => page.locator('.fiche');
const DATALAB = 2;          // catégorie « Projet »
const PORTAIL = 1;          // catégorie « Produit », hors périmètre

test('l en-tête porte le nom du projet et son type', async ({ page }) => {
    await D.ouvrirFiche(page, null, DATALAB);

    await expect(fiche(page).locator('.fiche-titre')).toHaveText('Datalab');
    await expect(fiche(page).locator('.fiche-type')).toHaveText('Projet "pré-produit"');
});

test('le cadrage montre les personnes et les engagements du projet', async ({ page }) => {
    await D.ouvrirFiche(page, null, DATALAB);

    await expect(fiche(page).locator('.bloc-responsable')).toContainText('Chloé Roux');
    await expect(fiche(page).locator('.bloc-sponsors')).toContainText('Alice Martin');
    await expect(fiche(page).locator('.bloc-contributeurs')).toContainText('Bruno Klein');
    await expect(fiche(page).locator('.bloc-contributeurs')).toContainText('David Sarr');
    await expect(fiche(page).locator('.bloc-description')).toContainText('bac à sable');
    await expect(fiche(page).locator('.bloc-commanditaires')).toContainText('I&D');
    await expect(fiche(page).locator('.bloc-budget')).toContainText('Inconnu');
});

test('une donnée de cadrage absente se dit, elle ne laisse pas un blanc', async ({ page }) => {
    const doc = D.documentCible();
    delete doc.Projects.records.find((p) => p.id === DATALAB).Budget_alloue;
    await D.ouvrirFiche(page, doc, DATALAB);

    await expect(fiche(page).locator('.bloc-budget')).toContainText('Non renseigné');
});

test('la feuille de route liste les chantiers du projet et leurs tâches', async ({ page }) => {
    await D.ouvrirFiche(page, null, DATALAB);

    await expect(fiche(page).locator('.fiche-ligne', { hasText: 'Guides utilisateurs' })).toHaveCount(1);
    await expect(fiche(page).locator('.fiche-ligne', { hasText: 'Guide de prise en main' })).toHaveCount(1);
    // Le chantier de l'autre projet n'a rien à faire ici.
    await expect(fiche(page).locator('.fiche-ligne', { hasText: 'Socle technique' })).toHaveCount(0);
});

test('les tâches d un chantier se replient et se déplient', async ({ page }) => {
    await D.ouvrirFiche(page, null, DATALAB);

    const chantier = fiche(page).locator('.fiche-ligne', { hasText: 'Guides utilisateurs' });
    await chantier.locator('.fiche-chevron').click();

    await expect(fiche(page).locator('.fiche-ligne', { hasText: 'Guide de prise en main' })).toHaveCount(0);

    await chantier.locator('.fiche-chevron').click();

    await expect(fiche(page).locator('.fiche-ligne', { hasText: 'Guide de prise en main' })).toHaveCount(1);
});

test('la fenêtre couvre six mois, du mois précédent aux cinq suivants', async ({ page }) => {
    await D.ouvrirFiche(page, null, DATALAB);

    const mois = await fiche(page).locator('.fiche-mois').allTextContents();
    expect(mois.length).toBe(6);

    const attendus = [];
    for (let i = -1; i <= 4; i++) {
        const d = new Date();
        d.setDate(1);
        d.setMonth(d.getMonth() + i);
        attendus.push(d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', ''));
    }
    expect(mois.map((m) => m.toLowerCase().slice(0, 3))).toEqual(attendus.map((m) => m.toLowerCase().slice(0, 3)));
});

test('la ligne du jour est tracée dans la fenêtre', async ({ page }) => {
    await D.ouvrirFiche(page, null, DATALAB);

    await expect(fiche(page).locator('.fiche-aujourdhui')).toBeVisible();
});

// La ligne du jour se mesure sur la piste, pas sur la largeur totale : la colonne des libellés
// décalerait le trait de plusieurs semaines.
test('la ligne du jour tombe sur la colonne de la semaine courante', async ({ page }) => {
    await D.ouvrirFiche(page, null, DATALAB);

    const ecart = await page.evaluate(() => {
        const trait = document.querySelector('.fiche-aujourdhui').getBoundingClientRect();
        const semaines = Array.from(document.querySelectorAll('.fiche-semaine'));
        const lundi = new Date();
        lundi.setHours(0, 0, 0, 0);
        lundi.setDate(lundi.getDate() - ((lundi.getDay() + 6) % 7));
        const t = new Date(Date.UTC(lundi.getFullYear(), lundi.getMonth(), lundi.getDate()));
        t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
        const numero = Math.ceil(((t - new Date(Date.UTC(t.getUTCFullYear(), 0, 1))) / 86400000 + 1) / 7);
        const colonne = semaines.find((s) => s.textContent === 'S' + numero);
        if (!colonne) return null;
        const c = colonne.getBoundingClientRect();
        return { dans: trait.left >= c.left - 1 && trait.left <= c.right + 1, semaine: numero };
    });

    expect(ecart).not.toBeNull();
    expect(ecart.dans).toBe(true);
});

// La colonne de la semaine courante est un fond. Peinte au-dessus, elle coupe les barres en deux :
// elle doit donc précéder les lignes, là où le trait du jour les suit.
test('la colonne de la semaine courante se peint sous les lignes', async ({ page }) => {
    await D.ouvrirFiche(page, null, DATALAB);

    const ordre = await page.evaluate(() => {
        const rang = document.querySelector('.fiche-rang');
        const avant = (sel) => {
            const e = document.querySelector(sel);
            return Boolean(e && (rang.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_PRECEDING));
        };
        return { colonne: avant('.fiche-colonne-courante'), trait: avant('.fiche-aujourdhui') };
    });

    expect(ordre.colonne).toBe(true);
    expect(ordre.trait).toBe(false);
});

test('rien ne s édite : ni création, ni volet, ni poignée', async ({ page }) => {
    await D.ouvrirFiche(page, null, DATALAB);

    await expect(page.locator('#btnAjouter')).toHaveCount(0);
    await expect(page.locator('#panel')).toHaveCount(0);
    await expect(fiche(page).locator('.resize-handle, .drag-handle')).toHaveCount(0);

    await fiche(page).locator('.fiche-ligne', { hasText: 'Guide de prise en main' }).click();

    await expect(page.locator('#panel')).toHaveCount(0);
});

test('une ligne qui n est pas un projet n ouvre pas de fiche', async ({ page }) => {
    await D.ouvrirFiche(page, null, PORTAIL, { attendre: '.fiche-hors-perimetre' });

    await expect(fiche(page).locator('.fiche-hors-perimetre')).toContainText('Produit');
    await expect(fiche(page).locator('.fiche-ligne')).toHaveCount(0);
});

// Le document du métier porte la catégorie en liste de choix, le modèle de référence en référence
// vers une table. La fiche lit les deux, sinon elle se croirait hors périmètre partout.
test('la catégorie se lit aussi quand elle est une liste de choix', async ({ page }) => {
    const doc = D.documentCible();
    doc.Projects.columns.Categorie = { type: 'Choice' };
    doc.Projects.records.find((p) => p.id === DATALAB).Categorie = 'Projet';
    await D.ouvrirFiche(page, doc, DATALAB);

    await expect(fiche(page).locator('.fiche-titre')).toHaveText('Datalab');
});

test('sans chantier, la feuille de route le dit', async ({ page }) => {
    const doc = D.documentCible();
    doc.Chantiers.records = doc.Chantiers.records.filter((c) => c.id !== 2);
    await D.ouvrirFiche(page, doc, DATALAB);

    await expect(fiche(page).locator('.fiche-route')).toContainText('Aucun chantier');
});
