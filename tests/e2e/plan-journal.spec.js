'use strict';

const path = require('path');
const base = require('@playwright/test');
const test = base.test;
const expect = base.expect;

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

// Le Plan reste vide chez certains utilisateurs sans qu'on sache ou le chargement s'arrete.
// Le journal doit permettre de le lire sur une simple capture de la console.

const DOC = {
    Tasks: {
        columns: { titre: { type: 'Text' }, statut: { type: 'Choice' }, dateDebut: { type: 'Date' }, dateEcheance: { type: 'Date' }, assignees: { type: 'RefList:Team' }, charges: { type: 'Text' }, dateCloture: { type: 'Date' }, estimationH: { type: 'Numeric' }, tempsPasse: { type: 'Numeric' }, projet: { type: 'Ref:Projects' } },
        records: [{ id: 1, titre: 'Cadrage', statut: 'inprogress', dateDebut: 1784152800, dateEcheance: 1784757600, assignees: ['L', 1], charges: '[{"teamId":1,"heures":20}]', estimationH: 20, tempsPasse: 5, projet: 1 }]
    },
    Team: {
        columns: { nom: { type: 'Text' }, role: { type: 'Choice' }, couleur: { type: 'Text' }, actif: { type: 'Bool' }, capaciteHebdo: { type: 'Numeric' }, indispos: { type: 'Text' } },
        records: [{ id: 1, nom: 'Membre Reel', role: 'Dev', couleur: '#3e5de7', actif: true, capaciteHebdo: 35 }]
    },
    Projects: { columns: { nom: { type: 'Text' }, couleur: { type: 'Text' } }, records: [{ id: 1, nom: 'Projet Reel', couleur: '#3e5de7' }] }
};

async function ouvrirPlan(page, options) {
    const journal = [];
    page.on('console', (m) => journal.push(m.type() + ' ' + m.text()));

    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: CHEMIN_SIMULACRE });
    await page.addInitScript((cfg) => {
        window.grist = window.createFakeGrist(cfg.doc);
        if (cfg.muet) window.grist.ready = () => new Promise(() => {});
        // Lecture qui ne repond jamais : ni resolue ni rejetee, comme une table qui ne
        // revient pas. Une lecture rejetee suit un tout autre chemin, deja couvert.
        if (cfg.bloquer) {
            const vrai = window.grist.docApi.fetchTable;
            let premiere = true;
            window.grist.docApi.fetchTable = function (nom) {
                if (nom !== cfg.bloquer || !premiere) return vrai.call(this, nom);
                premiere = false;   // seule la lecture d'ouverture traine, pas celles qui suivent
                if (!cfg.repondApres) return new Promise(() => {});
                return new Promise((r) => setTimeout(() => r(vrai.call(this, nom)), cfg.repondApres));
            };
        }
    }, options);

    // Horloge virtuelle pour les cas qui exercent un delai du widget, plutot que de l'attendre.
    if (options.bloquer) await page.clock.install();

    await page.goto('http://localhost:3001/tasks_app/gantt.html');
    await page.setContent('<iframe id="f" style="width:100%;height:600px;border:0" src="http://localhost:3001/tasks_app/plan.html?shell=1"></iframe>');
    if (options.bloquer) await page.clock.fastForward(11000);
    return journal;
}

const lignes = (journal) => journal.filter((l) => l.includes('[plan]'));
const alertes = (journal) => lignes(journal).filter((l) => l.startsWith('warning') || l.startsWith('error'));

test('le journal trace le handshake, les lectures et le rendu', async ({ page }) => {
    const journal = await ouvrirPlan(page, { doc: DOC, muet: false });

    await expect.poll(() => lignes(journal).join('\n')).toContain('handshake');
    const texte = lignes(journal).join('\n');

    // Chaque table lue est tracee avec son volume : c'est ce qui distingue « rien recu » de
    // « recu mais pas affiche ».
    for (const table of ['Tasks', 'Team', 'Projects']) expect(texte).toContain(table);
    expect(texte).toMatch(/1 ligne/);
    await expect.poll(() => lignes(journal).join('\n')).toMatch(/rendu/);
});

test('le repli sur les donnees d exemple est signale', async ({ page }) => {
    const journal = await ouvrirPlan(page, { doc: {}, muet: true });

    await expect.poll(() => alertes(journal).join('\n')).toContain('donnees d exemple');
});

// Une lecture qui ne repond jamais laissait le Plan sur « Chargement… » indefiniment : le
// filet du handshake ne s'applique pas, a raison, et le journal s'arretait sur les tables qui
// avaient repondu, sans nommer celle qui manquait. C'est le symptome « parfois rien ne se
// charge », et il etait indiagnosticable sur une capture de console.
test('une lecture sans reponse est nommee dans le journal', async ({ page }) => {
    const journal = await ouvrirPlan(page, { doc: DOC, bloquer: 'Tasks' });

    await expect.poll(() => alertes(journal).join('\n'), { timeout: 20000 }).toContain('aucune reponse pour Tasks');
});

test('une lecture sans reponse remplace le chargement par un message', async ({ page }) => {
    await ouvrirPlan(page, { doc: DOC, bloquer: 'Tasks' });
    const ecran = page.frameLocator('#f').locator('#gridwrap');

    await expect(ecran).toContainText('Tasks', { timeout: 20000 });
    await expect(ecran).not.toContainText('Chargement');
});

// Le message d'attente n'est pas un cul-de-sac : sur un poste lent la lecture aboutit, et la
// vue doit prendre sa place. Le repli sur les donnees d'exemple, lui, resterait affiche.
test('la vue s affiche quand une lecture tardive finit par repondre', async ({ page }) => {
    const journal = await ouvrirPlan(page, { doc: DOC, bloquer: 'Tasks', repondApres: 16000 });
    const ecran = page.frameLocator('#f').locator('#gridwrap');

    await expect(ecran).toContainText('En attente de Grist');

    await page.clock.fastForward(6000);

    await expect.poll(() => lignes(journal).join('\n')).toMatch(/rendu a/);
    await expect(ecran).not.toContainText('En attente de Grist');
    await expect(page.frameLocator('#f').locator('.demo-badge')).toHaveCount(0);
});

test('une table absente est signalee sans masquer la suite', async ({ page }) => {
    // Document sans la table Team : la lecture echoue, le Plan continue avec le reste.
    const journal = await ouvrirPlan(page, { doc: { Tasks: DOC.Tasks, Projects: DOC.Projects }, muet: false });

    await expect.poll(() => alertes(journal).join('\n')).toContain('Team');
    expect(lignes(journal).join('\n')).toContain('Tasks');
});
