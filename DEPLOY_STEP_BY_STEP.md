# Eden's Viper Network v6 — simple deployment

## Replace the complete GitHub project

1. Download and unzip the v6 package.
2. Open the GitHub repository connected to your Render chat service.
3. Delete the old project files in that repository, but do not delete the repository itself.
4. Choose **Add file → Upload files**.
5. Upload every item from inside the unzipped v6 folder, including `public`, `data`, `server.js`, `package.json`, `package-lock.json`, `render.yaml`, and the remaining files.
6. Commit the upload to the repository's main branch.

Uploading only the `public` folder updates the emojis and appearance but leaves all server-powered features broken. The whole project must be uploaded.

## Check Render settings

1. Open Render and select the existing Eden's Viper web service.
2. Open **Environment**.
3. Confirm these variables exist:
   - `OWNER_USERNAME` = `Eden's Viper`
   - `OWNER_PASSWORD` = your private owner password
   - `SESSION_SECRET` = a long private random value
   - `DATA_DIR` = `/var/data`
4. Save changes.
5. Choose **Manual Deploy → Deploy latest commit**.
6. Wait until Render says the deployment is **Live**.

## Confirm the correct server is live

1. Open the chat website and refresh it.
2. The top bar must say **SERVER v6 READY**.
3. Log in as `Eden's Viper`.
4. The **ADMIN** button must appear.
5. Click another member's name to see the working moderation buttons.

If the top bar says **SERVER UPDATE REQUIRED**, Render is still running the old `server.js` or is connected to a different GitHub repository/branch.
