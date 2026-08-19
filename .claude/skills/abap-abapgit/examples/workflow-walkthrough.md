# abapGit Workflow Walkthrough

Three end-to-end scenarios, in the order teams usually meet them. UI labels follow the
abapGit HTML UI (standalone report); the ADT abapGit Repositories view offers the same
operations for BTP systems. Companion deep dives:
[../references/repo-configuration.md](../references/repo-configuration.md) and
[../references/environments-and-ci.md](../references/environments-and-ci.md).

## Scenario A — Put an existing package on GitHub (first push)

Situation: package `ZINVOICE` with subpackages `ZINVOICE_CORE` and `ZINVOICE_UI`
exists in DEV; you want it versioned on GitHub.

1. **Create the repository on GitHub** — empty, or with only README/LICENSE.
   Note the HTTPS URL: `https://github.com/acme/zinvoice.git`.
2. **One-time system prep** (skip if done before):
   - abapGit installed as report `ZABAPGIT_STANDALONE`.
   - GitHub CA chain imported in `STRUST` → SSL Client (Anonymous); ICM restarted.
   - A GitHub personal access token created (used as the password).
3. **Link the package**: run `ZABAPGIT_STANDALONE` → *New Online* →
   - URL: `https://github.com/acme/zinvoice.git`
   - Package: `ZINVOICE` (already exists — that is fine, it is a dedicated tree)
   - Branch: `main`
   - Folder logic: `PREFIX` (subpackages follow the `ZINVOICE_*` convention)
4. **First pull attempt shows the repo state** — README/LICENSE from GitHub appear;
   add them to the `IGNORE` list in *Repository Settings* (or keep them outside
   `/src/`, where they are ignored anyway).
5. **Stage**: the repo view now shows every object of `ZINVOICE*` as new. Choose
   *Add All and Commit*.
6. **Commit**: message `Initial serialization of ZINVOICE`, committer name + email
   (mandatory). Authenticate with GitHub user + token when prompted.
7. **Verify on GitHub**: expected tree —

   ```
   .abapgit.xml
   README.md
   src/
     package.devc.xml
     core/
       package.devc.xml
       zcl_invoice_calculator.clas.abap
       zcl_invoice_calculator.clas.xml
     ui/
       package.devc.xml
       zinvoice_alv.prog.abap
       zinvoice_alv.prog.xml
   ```

Result: the package is versioned; every future change is a normal commit.

## Scenario B — Daily development loop (online repo)

Situation: repo from Scenario A, two developers, feature-branch workflow.

1. **Sync before you start**: open the repo in abapGit — it compares local and remote
   automatically. If a *Pull* action is offered, a colleague pushed something: pull,
   supply the transport request when prompted, let mass activation run, check the log.
2. **Branch**: create `feature/discount-validation` (on the git host or via abapGit's
   branch functions) and switch the repo to it. Remember: the system holds one
   checked-out state — coordinate who has which branch where.
3. **Develop** in SE80/ADT as usual. Objects are recorded on your transport request by
   normal CTS behavior; abapGit is not involved while you edit.
4. **Stage**: repo view → *Stage*. abapGit lists changed files —
   `zcl_invoice_calculator.clas.abap` (modified), a new
   `zcl_discount_validator.clas.abap` + `.xml`. *Add* them. A leftover `$TMP`-style
   experiment shows up too: *Ignore* it (lands in `.abapgit.xml` IGNORE).
5. **Commit**: message `Validate discount codes against condition table`, optional
   body for the why. Push happens with the commit.
6. **Pull request** on GitHub: `feature/discount-validation` → `main`; review runs
   there (plus abaplint CI, see
   [../references/environments-and-ci.md](../references/environments-and-ci.md)).
7. **After merge**: switch the repo back to `main` and pull, so the system matches the
   merged state. Delivery to QAS/PRD still travels by transport — release the
   transport request as usual. Git carries the history; CTS carries the change.

Conflict variant: if step 1's pull warns that `zcl_invoice_calculator.clas.abap`
differs locally *and* remotely, do not overwrite blindly — stage and commit your local
state to your feature branch first (or diff via the repo view) so nothing is lost,
then merge on the git side and pull the result.

## Scenario C — Offline transfer into an isolated system

Situation: a QA system with no internet access needs the current `ZINVOICE` code.

1. **Export from a connected clone**: on any machine, `git clone` the repo and zip its
   contents — or in a source SAP system, open the repo in abapGit and use
   *Export ZIP*.
2. **In the isolated system**: `ZABAPGIT_STANDALONE` → *New Offline* → name
   `zinvoice`, package `ZINVOICE` (created on the fly if missing) → *Create Offline
   Repo*.
3. ***Import ZIP***: select the zip; abapGit deserializes, prompts for a transport
   request (transportable package), runs activation. Review the log.
4. **Round trip**: after emergency fixes in the isolated system, *Export ZIP* and
   commit that zip's contents from a connected machine with normal git tooling —
   the offline format is identical to the online one.

## Scenario D (bonus) — On-premise package into SAP BTP ABAP environment

The documented cloud-migration on-ramp (details and limits in
[../references/environments-and-ci.md](../references/environments-and-ci.md)):

1. Serialize the on-premise package with community abapGit and push to a git repo
   that is reachable from the internet (Cloud Connector is not supported).
2. In ADT, connected to the BTP system: *Window → Show View → Other → abapGit
   Repositories* → link the repo URL → choose branch and target package → pull.
3. Fix what ABAP Cloud rejects at activation (unreleased APIs, forbidden object
   types) — see the abap-cloud-development and abap-modernization-playbook skills.
