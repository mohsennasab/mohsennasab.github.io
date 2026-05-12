# Deploying: GitHub repo, GitHub Pages, hydromohsen.com

Three stages. (1) Put the project in a GitHub repo so it is backed up and versioned. (2) Turn on GitHub Pages so the repo becomes a live site. (3) Point hydromohsen.com at it by changing DNS records at Squarespace. Windows / PowerShell throughout.

You need: a GitHub account (free, [github.com/signup](https://github.com/signup)) and access to the DNS settings for hydromohsen.com at Squarespace. Total active work is maybe 20 minutes; DNS then takes anywhere from a few minutes to a day to propagate.

---

## Stage 1: get the project into a GitHub repo

### 1a. Tell git who you are (one time, ever)

Your email is already set. Set your name:

```powershell
git config --global user.name "Mohsen Tahmasebi Nasab"
git config --global user.email "mohsen.tahmasebi.n@gmail.com"   # already set, harmless to re-run
```

### 1b. Make the project a repo and commit it

```powershell
cd "c:\OneDrive\OneDrive - AECOM\Automation Projects\Website"
git init
git branch -M main
git add -A
git commit -m "Initial commit: hydromohsen.com site"
```

`git add -A` respects `.gitignore`, so `node_modules\`, `dist\`, `Mohsen\`, `Photos\`, and the temp files are **not** included. Nothing sensitive goes in. The web-sized photos in `src\assets\` do go in (that is intended; they are small).

> Note: this folder lives inside OneDrive. Git inside OneDrive works fine. If OneDrive ever complains about a locked file in `.git\`, pause OneDrive sync for a moment and retry the git command.

### 1c. Create the empty repo on GitHub

1. Go to <https://github.com/new>.
2. **Repository name:** use `<your-username>.github.io` (replace `<your-username>` with your actual GitHub username, all lowercase). This special name makes the site live at `https://<your-username>.github.io` with no extra path. Any other name also works, but `<username>.github.io` is the cleanest for a personal site.
3. Leave it **Public** (GitHub Pages on the free plan requires a public repo; the source of any website is visible anyway, so this is normal and fine). If you ever want it private, that needs a paid GitHub plan, or you can host on Cloudflare Pages instead.
4. **Do not** check "Add a README" or add a `.gitignore` or license. You already have those locally; an empty repo avoids a merge conflict.
5. Click **Create repository**.

### 1d. Push your code up

GitHub shows you commands after creating the repo. Use the "push an existing repository" ones. They look like this (substitute your username):

```powershell
git remote add origin https://github.com/<your-username>/<your-username>.github.io.git
git push -u origin main
```

The first push will pop a browser window asking you to sign in to GitHub (Git for Windows ships with a credential helper that handles this). Approve it. After that, future pushes are silent.

From now on, whenever you change the site:

```powershell
git add -A
git commit -m "describe what you changed"
git push
```

That is your backup. Every commit is a restore point.

---

## Stage 2: turn on GitHub Pages

The project already includes the build workflow at `.github\workflows\deploy.yml` and the `public\CNAME` file (which contains `hydromohsen.com`), so there is almost nothing to configure.

1. On GitHub, open your repo, click **Settings** (top right of the repo), then **Pages** (left sidebar).
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Go to the **Actions** tab of the repo. You should see a workflow run called "Deploy to GitHub Pages" (it triggered on your push). Wait for the green check (about 1–2 minutes).
4. Back on **Settings → Pages**, you will see "Your site is live at https://<your-username>.github.io". Open it. The site should look exactly like your local dev preview.

Every time you `git push` to `main` from now on, this workflow rebuilds and republishes automatically. No manual deploy step.

---

## Stage 3: point hydromohsen.com at it

This is the part that touches Squarespace. Until you do this, the site only lives at `https://<your-username>.github.io`. After you do it, `hydromohsen.com` shows the new site (and the old Google Sites version goes away).

### 3a. Tell GitHub about the domain

1. **Settings → Pages → Custom domain.** Type `hydromohsen.com` and click **Save**. GitHub will start checking the DNS (it will show a yellow "DNS check in progress" until step 3b is done and propagates).
2. Leave **Enforce HTTPS** unchecked for now; you will tick it once DNS is working.

(The `public\CNAME` file already has `hydromohsen.com`, so this stays in sync when the workflow republishes.)

### 3b. Change the DNS records at Squarespace

Log in to Squarespace, go to the **DNS settings** for `hydromohsen.com` (this is the DNS records panel for the domain, not a website-editor page). You are looking for a list of records (Type / Host / Data).

**Add these records:**

| Type | Host | Value (Data) | TTL |
| --- | --- | --- | --- |
| A | `@` | `185.199.108.153` | default / 1h |
| A | `@` | `185.199.109.153` | default / 1h |
| A | `@` | `185.199.110.153` | default / 1h |
| A | `@` | `185.199.111.153` | default / 1h |
| AAAA | `@` | `2606:50c0:8000::153` | default / 1h |
| AAAA | `@` | `2606:50c0:8001::153` | default / 1h |
| AAAA | `@` | `2606:50c0:8002::153` | default / 1h |
| AAAA | `@` | `2606:50c0:8003::153` | default / 1h |
| CNAME | `www` | `<your-username>.github.io` | default / 1h |

(`@` means the bare domain, `hydromohsen.com` itself. Some Squarespace screens want it left blank or shown as the domain name; that is the same thing. The four AAAA records are IPv6; they are recommended but optional, the four A records are the important ones. The `www` CNAME makes `www.hydromohsen.com` work too; GitHub auto-redirects between the two.)

**Remove these old records** (they point at the current Google Sites site):

- Any **CNAME** with host `www` pointing to `ghs.googlehosted.com` (replace it with the one above).
- Any **A** records for `@` that are not the four GitHub IPs above (Google Sites or Squarespace defaults).
- Leave anything email-related alone (`MX` records, any `TXT` records for mail, SPF, DKIM, DMARC). Only touch the website-related `A`/`AAAA`/`CNAME` records.

Save the changes in Squarespace.

### 3c. Wait, then verify

DNS changes take effect anywhere from a few minutes to a day (usually under an hour). To check from PowerShell:

```powershell
nslookup hydromohsen.com           # should list the four 185.199.x.153 addresses
nslookup www.hydromohsen.com       # should show a CNAME to <your-username>.github.io
```

Once those look right, go back to **GitHub → Settings → Pages**. The "DNS check" should turn green. Now tick **Enforce HTTPS** (GitHub provisions a free Let's Encrypt certificate; this can take a few more minutes the first time).

Then open `https://hydromohsen.com` and `https://www.hydromohsen.com` in a browser. Both should show the new site with a valid padlock, and `www` should redirect to the bare domain (or vice versa).

---

## What this costs

- **GitHub Pages:** free.
- **The domain:** you keep paying Squarespace the yearly domain registration (around $20/year). Nothing changes there.
- **Google Sites:** it was free, so there is nothing to cancel. If you happen to have a paid Squarespace *website* plan (separate from the domain), you can cancel that once the new site is live; keep the domain registration.

## If something goes wrong

- **The new site at `<username>.github.io` looks broken / blank:** check the **Actions** tab for a failed workflow run; the log will say why. Usually a syntax error in a recently edited file. Fix locally, `git add -A && git commit -m fix && git push`, the workflow re-runs.
- **`hydromohsen.com` shows the old Google site for a while:** that is DNS caching. Wait it out, or test in a private/incognito window, or run `ipconfig /flushdns`.
- **`hydromohsen.com` shows a GitHub 404:** the custom-domain step (3a) was not saved, or the `CNAME` file got removed. Re-enter the domain in Settings → Pages; confirm `public\CNAME` still contains `hydromohsen.com`.
- **HTTPS won't enforce:** the green DNS check has to pass first, and it can take up to 24 hours after the records propagate. Try again later.
- **You changed the wrong DNS record:** Squarespace keeps the records editable; put it back. Email records (`MX`/`TXT`) should never have been touched.

## Quick sequence (once your GitHub account exists)

```powershell
# in the project folder
git config --global user.name "Mohsen Tahmasebi Nasab"
git init
git branch -M main
git add -A
git commit -m "Initial commit: hydromohsen.com site"
# create the repo <username>.github.io on github.com/new (public, empty), then:
git remote add origin https://github.com/<username>/<username>.github.io.git
git push -u origin main
# on GitHub: Settings -> Pages -> Source -> GitHub Actions, wait for the green check
# on GitHub: Settings -> Pages -> Custom domain -> hydromohsen.com -> Save
# in Squarespace DNS: add the four A records + four AAAA records + www CNAME; remove old Google Sites records
# wait for DNS, then on GitHub: Settings -> Pages -> Enforce HTTPS
```
