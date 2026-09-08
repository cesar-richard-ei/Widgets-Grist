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
        const colonne = document.querySelector('.fiche-semaine.courante');
        if (!colonne) return null;
        const c = colonne.getBoundingClientRect();
        return { dans: trait.left >= c.left - 1 && trait.left <= c.right + 1 };
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

test('une ligne qui n est pas un projet annonce sa fiche a venir', async ({ page }) => {
    await D.ouvrirFiche(page, null, PORTAIL, { attendre: '.fiche-bientot' });

    await expect(fiche(page).locator('.fiche-bientot-titre')).toContainText('La fiche Produit arrive bientôt');
    await expect(fiche(page).locator('.fiche-bientot-texte')).toContainText('Portail habilitations');
    await expect(fiche(page).locator('.fiche-bientot-texte')).not.toContainText('En attendant');
    await expect(fiche(page).locator('.fiche-ligne')).toHaveCount(0);
});

test('sans projet selectionne, l accueil invite a choisir une ligne du tableau', async ({ page }) => {
    await D.ouvrirFiche(page, null, null, { attendre: '.fiche-accueil' });

    await expect(fiche(page).locator('.fiche-accueil')).toContainText('Choisissez un projet dans le sélecteur ci-dessus');
    await expect(fiche(page).locator('.fiche-accueil-fleche')).toBeVisible();
    await expect(fiche(page).locator('.fiche-message')).toHaveCount(0);
    // La flèche désigne le sélecteur, posé au-dessus du widget : elle ouvre la ligne.
    expect(await page.evaluate(() => document.querySelector('.fiche-accueil-guide').firstElementChild.className))
        .toBe('fiche-accueil-fleche');
});

// La colonne de gauche ne garde que ce qui identifie la ligne : Paul lit la feuille de route pour
// des periodes, pas pour des dates au jour pres ni pour des personnes.
test('la feuille de route ne garde que les titres dans sa colonne de gauche', async ({ page }) => {
    await D.ouvrirFiche(page, null, DATALAB);

    await expect(fiche(page).locator('.fiche-dates')).toHaveCount(0);
    await expect(fiche(page).locator('.fiche-avatars')).toHaveCount(0);
    await expect(fiche(page).locator('.fiche-marque')).toHaveCount(0);
    await expect(fiche(page).locator('.fiche-compteur')).toHaveCount(0);
    await expect(fiche(page).locator('.fiche-ligne-tete')).toHaveText('Chantiers et tâches');
});

test('l en-tete de la fenetre ne numerote plus les semaines', async ({ page }) => {
    await D.ouvrirFiche(page, null, DATALAB);

    const semaines = await fiche(page).locator('.fiche-semaine').allTextContents();
    expect(semaines.length).toBeGreaterThan(0);
    expect(semaines.join('')).toBe('');
});

test('un titre long tient sur deux lignes', async ({ page }) => {
    const doc = D.documentCible();
    doc.Tasks.records.find((t) => t.id === 5).titre = 'Analyse de la plateforme applicative et cartographie complète des usages du datalab';
    await D.ouvrirFiche(page, doc, DATALAB);

    const mesure = await page.evaluate(() => {
        const nom = Array.from(document.querySelectorAll('.fiche-nom')).find((n) => n.textContent.startsWith('Analyse'));
        const style = getComputedStyle(nom);
        return { hauteur: nom.getBoundingClientRect().height, ligne: parseFloat(style.lineHeight) };
    });

    expect(Math.round(mesure.hauteur / mesure.ligne)).toBe(2);
});

test('les polices de la fiche suivent le standard du web', async ({ page }) => {
    await D.ouvrirFiche(page, null, DATALAB);

    const tailles = await page.evaluate(() => {
        const px = (sel) => parseFloat(getComputedStyle(document.querySelector(sel)).fontSize);
        return {
            description: px('.bloc-description .fiche-valeur'), badge: px('.fiche-personne'),
            libelle: px('.fiche-label'), section: px('.fiche-route h2')
        };
    });

    expect(tailles.description).toBeLessThanOrEqual(16);
    expect(tailles.badge).toBe(tailles.description);
    expect(tailles.libelle).toBeLessThan(tailles.description);
    expect(tailles.section).toBeLessThan(tailles.description);
});

test('la feuille de route ecrit plus petit que le reste de la fiche', async ({ page }) => {
    await D.ouvrirFiche(page, null, DATALAB);

    const maximum = await page.evaluate(() => Math.max(...Array.from(
        document.querySelectorAll('.fiche-grille, .fiche-grille *'),
        (e) => parseFloat(getComputedStyle(e).fontSize))));

    expect(maximum).toBeLessThanOrEqual(13);
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

// La table des personnes ne s'appelle pas « Team » partout : chaque colonne dit dans son type où
// ses références pointent. Un nom figé laissait toutes les pastilles vides.
test('les personnes se lisent dans la table que désignent les colonnes', async ({ page }) => {
    const doc = D.documentCible();
    doc.Effectifs = doc.Team;
    delete doc.Team;
    for (const [table, colonnes] of Object.entries({
        Projects: ['responsable', 'Sponsor', 'Contributeurs_cles'],
        Tasks: ['Responsable', 'assignees'],
        Chantiers: ['Responsable', 'Contributeurs']
    })) {
        colonnes.forEach((colId) => {
            const col = doc[table].columns[colId];
            if (col) col.type = col.type.replace(':Team', ':Effectifs');
        });
    }
    await D.ouvrirFiche(page, doc, DATALAB);

    await expect(fiche(page).locator('.bloc-responsable')).toContainText('Chloé Roux');
    await expect(fiche(page).locator('.bloc-sponsors')).toContainText('Alice Martin');
    await expect(fiche(page).locator('.bloc-contributeurs')).toContainText('Bruno Klein');
});

// Le serveur applique lui-même `expandRefs`, et celui qui héberge le document du métier l'ignore :
// une référence simple arrive sous son libellé quand une liste garde ses identifiants.
test('un responsable servi sous son nom se retrouve quand même', async ({ page }) => {
    await D.ouvrirFiche(page, null, DATALAB, {
        grist: { tableLiee: 'Projects', selection: DATALAB, refsAffichees: true }
    });

    await expect(fiche(page).locator('.bloc-responsable')).toContainText('Chloé Roux');
    await expect(fiche(page).locator('.bloc-sponsors')).toContainText('Alice Martin');
});

// Les options de sérialisation sont appliquées par le serveur, et chacun s'y prend à sa façon :
// seul l'identifiant de l'enregistrement servi est fiable, le reste se lit dans la table.
test('la fiche se lit dans la table, quelle que soit la forme servie', async ({ page }) => {
    await D.ouvrirFiche(page, null, DATALAB, {
        grist: { tableLiee: 'Projects', selection: DATALAB, refsOpaques: true }
    });

    await expect(fiche(page).locator('.bloc-responsable')).toContainText('Chloé Roux');
    await expect(fiche(page).locator('.bloc-sponsors')).toContainText('Alice Martin');
    await expect(fiche(page).locator('.fiche-titre')).toHaveText('Datalab');
});
