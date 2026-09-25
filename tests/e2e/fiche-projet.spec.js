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
        const colonne = document.querySelector('.fiche-colonne-courante');
        if (!colonne) return null;
        const c = colonne.getBoundingClientRect();
        return { dans: trait.left >= c.left - 1 && trait.left <= c.right + 1 };
    });

    expect(ecart).not.toBeNull();
    expect(ecart.dans).toBe(true);
});

// La feuille de route defile quand ses chantiers depassent la hauteur offerte : le trait du jour
// doit couvrir toute la liste, pas la seule hauteur visible au chargement.
test('la ligne du jour descend jusqu au dernier rang, feuille de route défilante', async ({ page }) => {
    const doc = D.documentCible();
    for (let i = 0; i < 24; i++) {
        doc.Tasks.records.push({
            id: 100 + i, titre: 'Lot ' + (i + 1), chantier: 2,
            dateDebut: D.j(-3), dateEcheance: D.j(12), statut: 'todo', type: 'tache', priorite: '3'
        });
    }

    await D.ouvrirFiche(page, doc, DATALAB);

    const bas = await page.evaluate(() => {
        const rangs = document.querySelectorAll('.fiche-rang');
        return {
            trait: document.querySelector('.fiche-aujourdhui').getBoundingClientRect().bottom,
            dernier: rangs[rangs.length - 1].getBoundingClientRect().bottom
        };
    });

    expect(bas.trait).toBeGreaterThanOrEqual(bas.dernier - 1);
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

test('une categorie sans fiche annonce celle qui vient', async ({ page }) => {
    const doc = D.documentCible();
    doc.Projects.records.find((p) => p.id === PORTAIL).Categorie = 4;   // Produit de données
    await D.ouvrirFiche(page, doc, PORTAIL, { attendre: '.fiche-bientot' });

    await expect(fiche(page).locator('.fiche-bientot-titre')).toContainText('La fiche Produit de données arrive bientôt');
    await expect(fiche(page).locator('.fiche-bientot-texte')).toContainText('Portail habilitations');
    await expect(fiche(page).locator('.fiche-bientot-texte')).not.toContainText('En attendant');
    await expect(fiche(page).locator('.fiche-ligne')).toHaveCount(0);
});

// Produit et Offre de service ouvrent la meme fiche que Projet. La feuille de route, elle, ne
// concerne pas le Produit : la maquette ne lui en donne pas.
test('la categorie Produit ouvre une fiche, sans feuille de route', async ({ page }) => {
    const doc = D.documentCible();
    doc.Projects.records.find((p) => p.id === PORTAIL).Categorie = 1;   // Produit
    await D.ouvrirFiche(page, doc, PORTAIL);

    await expect(fiche(page).locator('.fiche-bientot')).toHaveCount(0);
    await expect(fiche(page).locator('.bloc-responsable')).toContainText('Bruno Klein');
    await expect(fiche(page).locator('.fiche-route')).toHaveCount(0);
});

test('la categorie Offre de service ouvre une fiche avec sa feuille de route', async ({ page }) => {
    const doc = D.documentCible();
    doc.Projects.records.find((p) => p.id === DATALAB).Categorie = 3;   // Offre de service
    await D.ouvrirFiche(page, doc, DATALAB);

    await expect(fiche(page).locator('.fiche-bientot')).toHaveCount(0);
    await expect(fiche(page).locator('.fiche-route')).toHaveCount(1);
});

// Le bandeau porte la teinte de la categorie lue, pas une couleur unique ni celle de la ligne.
test('le bandeau prend la teinte de la categorie', async ({ page }) => {
    const teinte = async (projet, categorie) => {
        const doc = D.documentCible();
        doc.Projects.records.find((p) => p.id === projet).Categorie = categorie;
        await D.ouvrirFiche(page, doc, projet);
        return fiche(page).locator('.fiche-entete').evaluate((e) => getComputedStyle(e).backgroundColor);
    };

    expect(await teinte(DATALAB, 2)).toBe('rgb(30, 120, 211)');
});

test('la teinte du bandeau suit la categorie Produit', async ({ page }) => {
    const doc = D.documentCible();
    doc.Projects.records.find((p) => p.id === PORTAIL).Categorie = 1;
    await D.ouvrirFiche(page, doc, PORTAIL);

    await expect(fiche(page).locator('.fiche-entete')).toHaveCSS('background-color', 'rgb(120, 20, 118)');
});

// La teinte habille toute la fiche, pas seulement son bandeau : les pastilles de personnes la
// reprennent, comme sur la maquette.
test('les pastilles de personnes prennent la teinte de la categorie', async ({ page }) => {
    const doc = D.documentCible();
    doc.Projects.records.find((p) => p.id === PORTAIL).Categorie = 1;   // Produit
    await D.ouvrirFiche(page, doc, PORTAIL);

    await expect(fiche(page).locator('.fiche-personne').first()).toHaveCSS('background-color', 'rgb(120, 20, 118)');
});

test('la teinte du bandeau suit la categorie Offre de service', async ({ page }) => {
    const doc = D.documentCible();
    doc.Projects.records.find((p) => p.id === DATALAB).Categorie = 3;
    await D.ouvrirFiche(page, doc, DATALAB);

    await expect(fiche(page).locator('.fiche-entete')).toHaveCSS('background-color', 'rgb(127, 86, 4)');
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

test('l en-tete de la fenetre s arrete aux mois', async ({ page }) => {
    await D.ouvrirFiche(page, null, DATALAB);

    await expect(fiche(page).locator('.fiche-mois')).toHaveCount(6);
    await expect(fiche(page).locator('.fiche-semaines')).toHaveCount(0);
    await expect(fiche(page).locator('.fiche-semaine')).toHaveCount(0);
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
            libelle: px('.fiche-label')
        };
    });

    expect(tailles.description).toBeLessThanOrEqual(16);
    expect(tailles.badge).toBe(tailles.description);
    expect(tailles.libelle).toBeLessThan(tailles.description);
});

// L'en-tête de colonne fait exception : le métier l'a voulu plus lisible que les rangs.
test('la feuille de route ecrit plus petit que le reste de la fiche', async ({ page }) => {
    await D.ouvrirFiche(page, null, DATALAB);

    const maximum = await page.evaluate(() => Math.max(...Array.from(
        document.querySelectorAll('.fiche-grille, .fiche-grille *:not(.fiche-ligne-tete)'),
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

test('les pastilles de personnes n ont ni icone de lien ni coins arrondis au-dela de 2 px', async ({ page }) => {
    await D.ouvrirFiche(page, null, DATALAB);

    await expect(fiche(page).locator('.fiche-lien')).toHaveCount(0);
    const rayons = await fiche(page).locator('.fiche-personne').evaluateAll((els) =>
        els.map((e) => parseFloat(getComputedStyle(e).borderTopLeftRadius)));
    expect(rayons.length).toBeGreaterThan(0);
    rayons.forEach((r) => expect(r).toBeLessThanOrEqual(2));
});

test('les pastilles de personnes ont le meme retrait sur les quatre cotes', async ({ page }) => {
    await D.ouvrirFiche(page, null, DATALAB);

    const retraits = await fiche(page).locator('.fiche-personne').first().evaluate((e) => {
        const s = getComputedStyle(e);
        return [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft];
    });
    expect(new Set(retraits).size).toBe(1);
});

test('la feuille de route ne porte plus de titre au-dessus des chantiers', async ({ page }) => {
    await D.ouvrirFiche(page, null, DATALAB);

    await expect(fiche(page).locator('.fiche-grille')).toBeVisible();
    await expect(fiche(page).locator('.fiche-route h2')).toHaveCount(0);
});

test('l en-tete de colonne Chantiers et taches ecrit plus grand que les rangs', async ({ page }) => {
    await D.ouvrirFiche(page, null, DATALAB);

    const tailles = await page.evaluate(() => ({
        tete: parseFloat(getComputedStyle(document.querySelector('.fiche-ligne-tete')).fontSize),
        rang: parseFloat(getComputedStyle(document.querySelector('.fiche-rang .fiche-nom')).fontSize),
        description: parseFloat(getComputedStyle(document.querySelector('.bloc-description .fiche-valeur')).fontSize)
    }));

    expect(tailles.tete).toBeGreaterThan(tailles.rang);
    expect(tailles.tete).toBeLessThanOrEqual(tailles.description);
});

const avecStatut = (valeur) => {
    const doc = D.documentCible();
    doc.Projects.columns.Statut = {
        type: 'Choice',
        widgetOptions: JSON.stringify({
            choices: ['En cadrage', 'En réalisation'],
            choiceOptions: { 'En réalisation': { fillColor: '#C8F0D2', textColor: '#1C6B34' } }
        })
    };
    doc.Projects.records.find((p) => p.id === DATALAB).Statut = valeur;
    return doc;
};

test('le statut du projet ouvre le cadrage, aux couleurs de son choix', async ({ page }) => {
    await D.ouvrirFiche(page, avecStatut('En réalisation'), DATALAB);

    const pastille = fiche(page).locator('.fiche-colonne').first().locator('.fiche-bloc').first().locator('.fiche-statut');
    await expect(pastille).toHaveText('En réalisation');
    await expect(pastille).toHaveCSS('background-color', 'rgb(200, 240, 210)');
    await expect(pastille).toHaveCSS('color', 'rgb(28, 107, 52)');
    await expect(fiche(page).locator('.fiche-entete .fiche-statut')).toHaveCount(0);
});

test('un statut sans couleur definie garde une pastille neutre', async ({ page }) => {
    await D.ouvrirFiche(page, avecStatut('En cadrage'), DATALAB);

    await expect(fiche(page).locator('.bloc-statut .fiche-statut')).toHaveText('En cadrage');
});

// Grist écrit en noir un choix qui n'a qu'une couleur de fond : la pastille fait de même.
test('un statut qui n a qu une couleur de fond s ecrit en noir', async ({ page }) => {
    const doc = avecStatut('En cadrage');
    doc.Projects.columns.Statut.widgetOptions = JSON.stringify({
        choices: ['En cadrage'], choiceOptions: { 'En cadrage': { fillColor: '#FEF47A' } }
    });
    await D.ouvrirFiche(page, doc, DATALAB);

    const pastille = fiche(page).locator('.bloc-statut .fiche-statut');
    await expect(pastille).toHaveCSS('background-color', 'rgb(254, 244, 122)');
    await expect(pastille).toHaveCSS('color', 'rgb(0, 0, 0)');
});

test('sans statut renseigne, la fiche n en montre pas', async ({ page }) => {
    await D.ouvrirFiche(page, avecStatut(''), DATALAB);

    await expect(fiche(page).locator('.bloc-responsable')).toBeVisible();
    await expect(fiche(page).locator('.bloc-statut')).toHaveCount(0);
});

test('sans colonne statut, la fiche n en montre pas', async ({ page }) => {
    await D.ouvrirFiche(page, null, DATALAB);

    await expect(fiche(page).locator('.bloc-responsable')).toBeVisible();
    await expect(fiche(page).locator('.bloc-statut')).toHaveCount(0);
});

// Le chantier porte en bandeau le domaine de son responsable, a la couleur que le Gantt donne a ce
// domaine : Chloé porte « Expérience », en ocre.
test('un chantier porte en bandeau le domaine de son responsable', async ({ page }) => {
    await D.ouvrirFiche(page, null, DATALAB);

    const rang = fiche(page).locator('.fiche-rang.est-chantier', { hasText: 'Guides utilisateurs' });
    await expect(rang.locator('.fiche-ligne .bandeau-domaine')).toHaveText('Expérience');
    await expect(rang.locator('.fiche-ligne .bandeau-domaine')).toHaveCSS('background-color', 'rgb(245, 158, 11)');
    await expect(rang.locator('.fiche-piste .bandeau-domaine')).toHaveCount(1);
    await expect(fiche(page).locator('.fiche-rang:not(.est-chantier) .bandeau-domaine')).toHaveCount(0);
});

test('un chantier sans responsable garde un rang sans bandeau', async ({ page }) => {
    const doc = D.documentCible();
    delete doc.Chantiers.records.find((c) => c.id === 2).Responsable;
    await D.ouvrirFiche(page, doc, DATALAB);

    await expect(fiche(page).locator('.fiche-rang.est-chantier')).toHaveCount(1);
    await expect(fiche(page).locator('.bandeau-domaine')).toHaveCount(0);
});

const descriptionEnBase = (page) => page.evaluate(() => window.grist.docApi.fetchTable('Projects')
    .then((t) => t.Description[t.id.indexOf(2)]));

test('la description s edite depuis la fiche et part en base', async ({ page }) => {
    await D.ouvrirFiche(page, null, DATALAB);

    const champ = fiche(page).locator('.bloc-description textarea');
    await expect(champ).toHaveValue('Mettre un bac à sable à disposition des équipes.');
    await champ.fill('Ouvrir le datalab à toutes les équipes.');
    await champ.blur();

    await expect.poll(() => descriptionEnBase(page)).toBe('Ouvrir le datalab à toutes les équipes.');
    await expect(fiche(page).locator('.bloc-description textarea')).toHaveValue('Ouvrir le datalab à toutes les équipes.');
});

// Une relecture des tables pendant la saisie redessine la fiche : le texte en cours ne doit pas
// disparaître sous l'utilisateur.
test('une relecture pendant la saisie ne perd pas le texte en cours', async ({ page }) => {
    await D.ouvrirFiche(page, null, DATALAB);

    const champ = fiche(page).locator('.bloc-description textarea');
    await champ.fill('Texte en cours de frappe');
    await page.evaluate(() => window.grist.docApi.applyUserActions([['UpdateRecord', 'Projects', 2, { Budget_alloue: '10 k€' }]]));

    await expect(fiche(page).locator('.bloc-budget')).toContainText('10 k€');
    await expect(fiche(page).locator('.bloc-description textarea')).toHaveValue('Texte en cours de frappe');
    await expect(fiche(page).locator('.bloc-description textarea')).toBeFocused();
});

test('une description calculee reste en lecture seule', async ({ page }) => {
    const doc = D.colonneCalculee(D.documentCible(), 'Projects', 'Description');
    await D.ouvrirFiche(page, doc, DATALAB);

    await expect(fiche(page).locator('.bloc-description textarea')).toHaveCount(0);
    await expect(fiche(page).locator('.bloc-description')).toContainText('bac à sable');
});

test('un champ editable se distingue des champs en lecture seule', async ({ page }) => {
    await D.ouvrirFiche(page, null, DATALAB);

    const fond = (sel) => fiche(page).locator(sel).evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(await fond('.bloc-description textarea')).not.toBe(await fond('.bloc-budget .fiche-valeur'));
});

const avecActualites = () => {
    const doc = D.documentCible();
    doc.Projects.columns.Actualites = { type: 'Text' };
    doc.Projects.records.find((p) => p.id === DATALAB).Actualites = 'Ouverture aux équipes en octobre.';
    return doc;
};

test('l actualite du projet s affiche et s edite quand la colonne existe', async ({ page }) => {
    await D.ouvrirFiche(page, avecActualites(), DATALAB);

    const champ = fiche(page).locator('.bloc-actualites textarea');
    await expect(champ).toHaveValue('Ouverture aux équipes en octobre.');
    await champ.fill('Ouverture repoussée à novembre.');
    await champ.blur();

    await expect.poll(() => page.evaluate(() => window.grist.docApi.fetchTable('Projects')
        .then((t) => t.Actualites[t.id.indexOf(2)]))).toBe('Ouverture repoussée à novembre.');
});

test('une actualite vide ne s affiche pas', async ({ page }) => {
    const doc = avecActualites();
    doc.Projects.records.find((p) => p.id === DATALAB).Actualites = '';
    await D.ouvrirFiche(page, doc, DATALAB);

    await expect(fiche(page).locator('.bloc-description')).toBeVisible();
    await expect(fiche(page).locator('.bloc-actualites')).toHaveCount(0);
});

test('l actualite se lit entre l en-tete et le cadrage', async ({ page }) => {
    await D.ouvrirFiche(page, avecActualites(), DATALAB);

    const ordre = await fiche(page).evaluate((f) => Array.from(f.children).map((e) => e.className));
    expect(ordre.findIndex((c) => c.includes('bloc-actualites'))).toBe(ordre.findIndex((c) => c.includes('fiche-entete')) + 1);
    expect(ordre.findIndex((c) => c.includes('fiche-cadrage'))).toBeGreaterThan(ordre.findIndex((c) => c.includes('bloc-actualites')));
});

test('sans colonne actualite, la fiche n en montre pas', async ({ page }) => {
    await D.ouvrirFiche(page, null, DATALAB);

    await expect(fiche(page).locator('.bloc-description')).toBeVisible();
    await expect(fiche(page).locator('.bloc-actualites')).toHaveCount(0);
});

test('une saisie d actualite survit a une relecture des tables', async ({ page }) => {
    await D.ouvrirFiche(page, avecActualites(), DATALAB);

    const champ = fiche(page).locator('.bloc-actualites textarea');
    await champ.fill('Brouillon en cours');
    await page.evaluate(() => window.grist.docApi.applyUserActions([['UpdateRecord', 'Projects', 2, { Budget_alloue: '12 k€' }]]));

    await expect(fiche(page).locator('.bloc-budget')).toContainText('12 k€');
    await expect(fiche(page).locator('.bloc-actualites textarea')).toHaveValue('Brouillon en cours');
    await expect(fiche(page).locator('.bloc-actualites textarea')).toBeFocused();
});
