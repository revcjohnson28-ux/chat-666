# Eden's Viper Network v4 — Voice + Video

A deployable Paltalk-style community chat built with Node.js, Express, Socket.IO and WebRTC.

## New in v4

- Room voice through WebRTC
- Room camera/video through WebRTC
- Mic and camera are OFF by default
- Independent mic and camera buttons
- Active broadcaster video/audio tiles
- Mic/camera indicators in the member list
- Owner/moderator can mute a member's mic or turn off a member's camera
- Room changes clean up old peer connections
- Existing text chat, accounts, private messages, rooms and moderation remain intact

## Deploy over your current Render service

If your existing GitHub repository is already connected to Render:

1. Back up your current repository if desired.
2. Replace the old v3 source files with the files from this v4 package.
3. Commit/push the changes to the same branch Render watches.
4. Render should automatically redeploy. If it does not, use Manual Deploy -> Deploy latest commit.
5. Keep the same environment variables and persistent disk settings you already use.

The live URL can remain the same (for example `https://chat-666.onrender.com/`). Your Bandzoogle iframe and existing desktop clients do not need a new server URL.

## Important WebRTC note

This version uses public STUN servers for direct peer-to-peer connections. This is appropriate for initial testing and smaller rooms, but some restrictive networks/NATs will not be able to connect directly. For reliable public service, add a TURN relay server. For larger rooms, use an SFU architecture (for example LiveKit, mediasoup, Janus or similar) rather than a full mesh.

## Browser permissions

Camera and microphone access requires HTTPS or localhost. Render provides HTTPS. If embedding in Bandzoogle, the iframe must include permissions such as:

```html
allow="microphone; camera; fullscreen"
```

## Environment variables

- `OWNER_USERNAME` — defaults to `Eden's Viper`
- `OWNER_PASSWORD` — required for owner login
- `SESSION_SECRET` — long random secret
- `DATA_DIR` — persistent data path, `/var/data` on the included Render configuration

## Local test

```bash
npm install
OWNER_PASSWORD='choose-a-test-password' SESSION_SECRET='choose-a-random-secret' npm start
```

Then open `http://localhost:3000`.
