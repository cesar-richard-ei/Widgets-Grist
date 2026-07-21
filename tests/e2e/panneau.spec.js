'use strict';

const { test, expect } = require('./harness.js');

// Ouvre la premiere ligne visible et renvoie son data-id : la liste est triee par
// sortTasks() et la hierarchie WBS replie certaines lignes, donc l'identifiant de la
// premiere ligne affichee ne correspond pas forcement au premier enregistrement de la table.
async function ouvrirPremiereTache(page) {
    const premiereLigne = page.locator('#taskList .task-row').first();
    const id = Number(await premiereLigne.getAttribute('data-id'));
    await premiereLigne.click();
    await expect(page.locator('#panel')).toHaveClass(/open/);
    return id;
}

// Ouvre la ligne visible a l'indice donne (0-based) et renvoie son data-id.
async function ouvrirTacheAIndice(page, indice) {
    const ligne = page.locator('#taskList .task-row').nth(indice);
    const id = Number(await ligne.getAttribute('data-id'));
    await ligne.click();
    await expect(page.locator('#panel')).toHaveClass(/open/);
    return id;
}

// Lit une colonne de la table Tasks pour un identifiant donne, via le simulacre.
async function lireChampTache(page, id, colonne) {
    return page.evaluate(async ({ taskId, col }) => {
        const t = await window.grist.docApi.fetchTable('Tasks');
        return t[col][t.id.indexOf(taskId)];
    }, { taskId: id, col: colonne });
}

test('cliquer une tache ouvre le panneau et decale le Gantt', async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);
    await expect(gantt.locator('#ganttWrapper')).toHaveClass(/panel-open/);
    await expect(gantt.locator('#taskTitle')).toBeVisible();
});

test('la croix ferme le panneau', async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);
    await gantt.locator('#panelHeader .panel-close').click();
    await expect(gantt.locator('#panel')).not.toHaveClass(/open/);
});

test('la touche Echap ferme le panneau', async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);
    await gantt.keyboard.press('Escape');
    await expect(gantt.locator('#panel')).not.toHaveClass(/open/);
});

test('changer le statut persiste immediatement', async ({ gantt }) => {
    // Deuxieme ligne affichee (tri priorite par defaut) : "API backend", cinquieme
    // enregistrement seede. Sa position affichee (indice 1) differe de sa position en
    // table (indice 4), ce qui exerce reellement la recherche par identifiant.
    const id = await ouvrirTacheAIndice(gantt, 1);
    const statutInitial = await lireChampTache(gantt, id, 'statut');

    // Choisit un statut different du statut courant parmi les pills reellement rendues,
    // plutot que de coder une valeur en dur.
    const statuts = await gantt.locator('.status-pill').evaluateAll((pills) => pills.map((p) => p.dataset.status));
    const statutCible = statuts.find((s) => s !== statutInitial);
    expect(statutCible).toBeTruthy();

    await gantt.locator('.status-pill[data-status="' + statutCible + '"]').click();
    await expect(gantt.locator('#saveIndicator')).toHaveClass(/visible/);

    const statutFinal = await lireChampTache(gantt, id, 'statut');
    expect(statutFinal).toBe(statutCible);
    expect(statutFinal).not.toBe(statutInitial);
});

test('la description saisie est persistee a la fermeture du panneau', async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);
    await gantt.locator('#taskDescription').fill('Cadrage a valider avec le metier');
    await gantt.locator('#panelHeader .panel-close').click();

    const description = await gantt.evaluate(async () => {
        const t = await window.grist.docApi.fetchTable('Tasks');
        return t.description[0];
    });
    expect(description).toBe('Cadrage a valider avec le metier');
});

test('le titre saisi est persiste a la fermeture du panneau', async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);
    await gantt.locator('#taskTitle').fill('Titre revise');
    await gantt.locator('#panelHeader .panel-close').click();

    const titre = await gantt.evaluate(async () => {
        const t = await window.grist.docApi.fetchTable('Tasks');
        return t.titre[0];
    });
    expect(titre).toBe('Titre revise');
});

test('la saisie est persistee meme en fermant par Echap', async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);
    await gantt.locator('#taskDescription').fill('Saisie fermee au clavier');
    await gantt.keyboard.press('Escape');

    const description = await gantt.evaluate(async () => {
        const t = await window.grist.docApi.fetchTable('Tasks');
        return t.description[0];
    });
    expect(description).toBe('Saisie fermee au clavier');
});

test('quitter le champ persiste sans fermer le panneau', async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);
    await gantt.locator('#taskDescription').fill('Persistee en quittant le champ');
    await gantt.locator('#taskTitle').click();
    await expect(gantt.locator('#saveIndicator')).toHaveClass(/visible/);
});

test('fermer sans rien modifier n emet aucune ecriture', async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);
    const avant = await gantt.evaluate(() => window.grist._log.length);
    await gantt.locator('#panelHeader .panel-close').click();
    const apres = await gantt.evaluate(() => window.grist._log.length);
    expect(apres).toBe(avant);
});

test('les fleches naviguent entre les taches', async ({ gantt }) => {
    const premierId = await ouvrirPremiereTache(gantt);
    const premier = await gantt.locator('#taskTitle').inputValue();

    // La tache attendue apres un clic sur "suivant" est celle qui occupe la deuxieme
    // position dans la liste affichee, pas simplement une tache differente de la premiere.
    const idSuivantAttendu = Number(await gantt.locator('#taskList .task-row').nth(1).getAttribute('data-id'));
    expect(idSuivantAttendu).not.toBe(premierId);
    const titreSuivantAttendu = await lireChampTache(gantt, idSuivantAttendu, 'titre');

    await gantt.locator('#panelHeader .panel-nav-btn').last().click();
    const suivant = await gantt.locator('#taskTitle').inputValue();

    expect(suivant).not.toBe(premier);
    expect(suivant).toBe(titreSuivantAttendu);
});
