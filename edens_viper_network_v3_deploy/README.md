# Eden's Viper Network v3

A deployable Paltalk-style real-time community chat for edensviper.com.

## Included
- Account registration and password login
- Passwords hashed with Node.js scrypt
- Secure owner role controlled by environment variables (no username-only owner access)
- Owner and moderator roles
- Kick and ban controls
- Persistent rooms, room messages, private messages, profiles, users, and bans
- Private messaging
- User bios and online member list
- Room creation by owner/moderators
- Socket.IO live chat
- Bandzoogle-friendly responsive layout
- Render Blueprint (`render.yaml`)
- Health endpoint at `/health`

## Run locally
1. Copy `.env.example` values into your shell/environment. Do not commit your real password.
2. Run `npm install`.
3. Set at minimum `OWNER_PASSWORD` and ideally `SESSION_SECRET`.
4. Run `npm start`.
5. Open `http://localhost:3000`.

Example on macOS/Linux:

    export OWNER_USERNAME="Eden's Viper"
    export OWNER_PASSWORD="your-long-private-password"
    export SESSION_SECRET="your-long-random-secret"
    npm install
    npm start

## Deploy on Render
The included `render.yaml` creates a Node web service and a 1 GB persistent disk mounted at `/var/data`.

1. Put this project in a GitHub repository.
2. In Render choose New > Blueprint and connect that repository.
3. Render reads `render.yaml`.
4. When prompted, set `OWNER_PASSWORD` to a strong private password.
5. Deploy.
6. Open the assigned `https://...onrender.com` URL and log in using the owner username and the password you set.

The persistent disk requires a paid Render web-service plan. Without a persistent disk, Render's filesystem is ephemeral and account/message changes can be lost during redeploys or restarts.

## Bandzoogle embed
After Render gives you a chat URL, add an HTML/code block on your Bandzoogle Chat page:

    <iframe
      src="https://YOUR-CHAT.onrender.com"
      width="100%"
      height="850"
      frameborder="0"
      allow="microphone; camera; fullscreen"
      style="border:0;width:100%;min-height:850px">
    </iframe>

Later, you can add a custom domain such as `chat.edensviper.com` in Render and use that URL in the iframe.

## Important security notes
- Never put the real owner password in source code, GitHub, or Bandzoogle HTML.
- Set `OWNER_PASSWORD` only in Render's environment-variable controls.
- Keep `SESSION_SECRET` secret.
- For a larger public community, migrate the JSON data store to a managed database such as PostgreSQL. This version is intended for a small community and a single server instance.
