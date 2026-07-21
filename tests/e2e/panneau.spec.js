'use strict';

const { test, expect, ouvrirPremiereTache, ouvrirTacheAIndice, lireChampTache } = require('./harness.js');

// ═══════════════════════════════════════════════════════════════════════
// Comportement existant du panneau (non lie a un correctif particulier)
// ═══════════════════════════════════════════════════════════════════════
test.describe('Panneau — comportement existant', () => {
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
});

// ═══════════════════════════════════════════════════════════════════════
// Correctifs de persistance de la saisie en attente
// ═══════════════════════════════════════════════════════════════════════
test.describe('Panneau — persistance de la saisie en attente (correctifs)', () => {
    test('la description saisie est persistee des la perte du focus', async ({ gantt }) => {
        const id = await ouvrirPremiereTache(gantt);

        // Geste reel : clic dans le champ puis frappe au clavier. Un `fill()` declencherait
        // lui-meme l'evenement `change` et rendrait ce test vrai meme si `onchange` etait
        // retire du champ : seule la frappe reelle, suivie d'une perte de focus reelle,
        // exerce specifiquement la voie `onchange`.
        await gantt.locator('#taskDescription').click();
        await gantt.keyboard.type('Cadrage a valider avec le metier');

        // Quitte le champ sans fermer le panneau : la sauvegarde ne peut venir que de
        // l'evenement change du champ, pas du flush de closePanel/openTaskPanel.
        await gantt.locator('#taskTitle').click();
        await expect(gantt.locator('#panel')).toHaveClass(/open/);
        await expect(gantt.locator('#saveIndicator')).toHaveClass(/visible/);

        const description = await lireChampTache(gantt, id, 'description');
        expect(description).toBe('Cadrage a valider avec le metier');
    });

    test('le titre saisi est persiste a la fermeture du panneau', async ({ gantt }) => {
        const id = await ouvrirPremiereTache(gantt);

        // Geste reel : clic, selection du titre existant, frappe au clavier, puis fermeture
        // au clavier (Echap) sans jamais quitter le champ. Le champ ne perd donc jamais le
        // focus et n'emet aucun `change` : seul le flush de closePanel peut ecrire la saisie.
        const champ = gantt.locator('#taskTitle');
        await champ.click({ clickCount: 3 });
        await gantt.keyboard.type('Titre revise');
        await gantt.keyboard.press('Escape');

        const titre = await lireChampTache(gantt, id, 'titre');
        expect(titre).toBe('Titre revise');
    });

    test('fermer sans rien modifier n emet aucune ecriture', async ({ gantt }) => {
        await ouvrirPremiereTache(gantt);
        const avant = await gantt.evaluate(() => window.grist._log.length);
        await gantt.locator('#panelHeader .panel-close').click();
        const apres = await gantt.evaluate(() => window.grist._log.length);
        expect(apres).toBe(avant);
    });

    test('basculer sur une autre tache n emet aucune ecriture parasite a la fermeture', async ({ gantt }) => {
        const premierId = await ouvrirPremiereTache(gantt);

        // Saisie declenchee sans donner le focus au champ : un vrai clic dans le champ puis
        // ailleurs provoquerait un blur natif, qui sauvegarde et vide l indicateur via la voie
        // normale (onchange) avant meme que la bascule de tache n intervienne, masquant ainsi
        // le defaut vise. On reproduit uniquement l evenement input (comme le ferait la frappe),
        // qui laisse l indicateur arme jusqu a la bascule elle-meme.
        await gantt.evaluate(() => {
            const champ = document.getElementById('taskDescription');
            champ.value = 'Description modifiee avant bascule';
            champ.dispatchEvent(new Event('input', { bubbles: true }));
        });

        // Clique sur la deuxieme ligne affichee : la premiere tache doit s ecrire au passage.
        const deuxiemeId = await ouvrirTacheAIndice(gantt, 1);
        expect(deuxiemeId).not.toBe(premierId);

        const descriptionPremiere = await lireChampTache(gantt, premierId, 'description');
        expect(descriptionPremiere).toBe('Description modifiee avant bascule');

        const avant = await gantt.evaluate(() => window.grist._log.length);
        await gantt.locator('#panelHeader .panel-close').click();
        const apres = await gantt.evaluate(() => window.grist._log.length);
        expect(apres).toBe(avant);
    });

    test('passer en creation depuis la barre d outils persiste la saisie en attente', async ({ gantt }) => {
        const id = await ouvrirPremiereTache(gantt);

        // Geste reel : clic dans le champ puis frappe au clavier, comme pour les deux tests
        // precedents. C'est la quatrieme sortie du panneau (creation via la barre d'outils),
        // oubliee par le correctif initial qui ne couvrait que closePanel et openTaskPanel.
        await gantt.locator('#taskDescription').click();
        await gantt.keyboard.type('Description saisie avant creation');

        await gantt.locator('.header-right .btn.primary').click();

        await expect(gantt.locator('#panel')).toHaveClass(/open/);
        const description = await lireChampTache(gantt, id, 'description');
        expect(description).toBe('Description saisie avant creation');
    });
});
