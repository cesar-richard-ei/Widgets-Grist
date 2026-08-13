'use strict';

const path = require('path');
const base = require('@playwright/test');
const test = base.test;
const expect = base.expect;

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

// Un bandeau intercalaire porte le sujet de niveau 1, c'est a dire le projet, produit ou offre
// de service, avec sa categorie en badge. Il se replie et reste colle en haut au defilement.

const jour = 86400;
const aujourdhui = Math.floor(Date.now() / 1000 / jour) * jour;
const j = (n) => aujourdhui + n * jour;

const DOC = {
    Categorie_de_projet: {
        columns: { Categorie: { type: 'Text' } },
        records: [{ id: 1, Categorie: 'Projet' }, { id: 2, Categorie: 'Produit' }]
    },
    Projects: {
        columns: { nom: { type: 'Text' }, couleur: { type: 'Text' }, actif: { type: 'Bool' }, Categorie: { type: 'Ref:Categorie_de_projet' } },
        records: [
            { id: 1, nom: 'Portail habilitations', couleur: '#3e5de7', actif: true, Categorie: 1 },
            { id: 2, nom: 'Datalab', couleur: '#10b981', actif: true, Categorie: 2 }
        ]
    },
    Team: { columns: { nom: { type: 'Text' }, actif: { type: 'Bool' }, couleur: { type: 'Text' } }, records: [{ id: 1, nom: 'Alice', actif: true, couleur: '#3e5de7' }] },
    Chantiers: {
        columns: {
            Nom_du_chantier: { type: 'Text' }, Description: { type: 'Text' },
            Date_debut: { type: 'Date' }, Date_fin: { type: 'Date' },
            Projets: { type: 'RefList:Projects' }, Contributeurs: { type: 'RefList:Team' }, Responsable: { type: 'Ref:Team' }
        },
        records: [
            { id: 1, Nom_du_chantier: 'Socle technique', Date_debut: j(-5), Date_fin: j(20), Projets: ['L', 1] },
            { id: 2, Nom_du_chantier: 'PoC IA', Date_debut: j(-3), Date_fin: j(15), Projets: ['L', 2] }
        ]
    },
    Tasks: {
        columns: {
            chantier: { type: 'Ref:Chantiers' }, parentTask: { type: 'Ref:Tasks' },
            titre: { type: 'Text' }, description: { type: 'Text' }, dateDebut: { type: 'Date' }, dateEcheance: { type: 'Date' },
            priorite: { type: 'Choice' }, statut: { type: 'Choice' }, progression: { type: 'Numeric' },
            assignees: { type: 'RefList:Team' }, type: { type: 'Choice' }, dependDe: { type: 'RefList:Tasks' },
            tags: { type: 'ChoiceList' }, estimationH: { type: 'Numeric' }, tempsPasse: { type: 'Numeric' },
            couleur: { type: 'Text' }, subtasks: { type: 'Text' }, projet: { type: 'Ref:Projects' },
            charges: { type: 'Text' }, dateCloture: { type: 'Date' }
        },
        records: [
            { id: 1, titre: 'Cadrage', chantier: 1, dateDebut: j(-4), dateEcheance: j(6), statut: 'todo', type: 'tache', priorite: '1' },
            { id: 2, titre: 'Entrainement modele', chantier: 2, dateDebut: j(-2), dateEcheance: j(9), statut: 'todo', type: 'tache', priorite: '2' }
        ]
    }
};

async function ouvrirGantt(page, doc) {
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: CHEMIN_SIMULACRE });
    await page.addInitScript((d) => {
        window.grist = window.createFakeGrist(d);
        try { localStorage.removeItem('taskflow_gantt_expanded'); localStorage.removeItem('taskflow_gantt_groupes_replies'); } catch (e) {}
    }, doc);
    await page.goto('http://localhost:3001/tasks_app/gantt.html');
    await page.waitForSelector('#taskList .task-row');
}

const bandeaux = (page) => page.locator('#taskList .groupe-projet');
const bandeau = (page, nom) => page.locator('#taskList .groupe-projet', { hasText: nom });

test('un bandeau porte le nom du projet et sa categorie', async ({ page }) => {
    await ouvrirGantt(page, DOC);

    await expect(bandeaux(page)).toHaveCount(2);
    await expect(bandeau(page, 'Portail habilitations')).toContainText('Projet');
    await expect(bandeau(page, 'Datalab')).toContainText('Produit');
});

test('le bandeau precede les chantiers de son projet', async ({ page }) => {
    await ouvrirGantt(page, DOC);

    const libelles = await page.evaluate(() => [...document.querySelectorAll('#taskList > div')].map(l =>
        (l.classList.contains('groupe-projet') ? 'GROUPE ' : 'LIGNE ') + l.innerText.replace(/\s+/g, ' ').trim()));

    expect(libelles[0]).toContain('GROUPE');
    expect(libelles.filter(l => l.startsWith('GROUPE')).length).toBe(2);
    // Le chantier suit immediatement le bandeau de son projet.
    const iPortail = libelles.findIndex(l => l.includes('Portail habilitations'));
    expect(libelles[iPortail + 1]).toContain('Socle technique');
});

test('replier un bandeau masque les lignes de son projet', async ({ page }) => {
    await ouvrirGantt(page, DOC);
    await expect(page.locator('#taskList .task-row', { hasText: 'Socle technique' })).toBeVisible();

    await bandeau(page, 'Portail habilitations').locator('.groupe-chevron').click();

    await expect(page.locator('#taskList .task-row', { hasText: 'Socle technique' })).toHaveCount(0);
    // L'autre projet n'est pas affecte.
    await expect(page.locator('#taskList .task-row', { hasText: 'PoC IA' })).toBeVisible();
});

// Les barres et les lignes de la timeline sont posees a l'index de la ligne : un bandeau qui
// n'occuperait pas sa ligne dans la timeline decalerait tout le Gantt.
test('la timeline garde une ligne par ligne affichee', async ({ page }) => {
    await ouvrirGantt(page, DOC);

    const aligne = await page.evaluate(() => ({
        gauche: document.querySelectorAll('#taskList > div').length,
        timeline: document.querySelectorAll('#timelineGrid .grid-row').length
    }));
    expect(aligne.timeline).toBe(aligne.gauche);

    // La barre d'une tache reste en face de sa ligne, une fois son chantier deplie.
    await page.locator('#taskList .task-row', { hasText: 'Socle technique' }).locator('.tree-chevron').click();
    await expect(page.locator('#taskList .task-row', { hasText: 'Cadrage' })).toBeVisible();

    const ecart = await page.evaluate(() => {
        const ligne = [...document.querySelectorAll('#taskList > div')].findIndex(l => l.innerText.includes('Cadrage'));
        const barre = document.querySelector('#timelineGrid .gantt-bar[data-id="1"]');
        return barre ? Math.abs(parseFloat(barre.style.top) - (ligne * 44 + 10)) : null;
    });
    expect(ecart).toBeLessThan(1);
});

test('sans table de categories, le bandeau garde le nom du projet', async ({ page }) => {
    const doc = JSON.parse(JSON.stringify(DOC));
    delete doc.Categorie_de_projet;
    await ouvrirGantt(page, doc);

    await expect(bandeau(page, 'Portail habilitations')).toBeVisible();
});
