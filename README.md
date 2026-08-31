# Eden's Viper Network v6

A Paltalk + Discord-style community chat built on Node.js, Socket.IO and WebRTC.

## v6 features

- Persistent username/password accounts
- Protected owner account from `OWNER_USERNAME` / `OWNER_PASSWORD`
- Owner admin panel with service-wide ban/unban and moderator assignment
- Room kick with a temporary re-entry lock
- Moderator/owner mic and camera locks
- "Allow mic" / "Allow video" removes the moderation lock; browsers intentionally do not allow an administrator to silently turn another person's mic/camera on
- User blocking, with the owner account exempt from being blocked
- DMs between members, moderators and owner; DMs continue to work for offline registered users when they return
- DM file sharing with allow-listed file types and configurable upload size
- Inline direct image/video links and YouTube embeds in room chat and DMs
- Gothic emoji picker
- WebRTC voice/video room broadcasting
- Persistent messages, rooms, bans, blocks and DM history
- Visible `SERVER v6 READY` check so a partial deployment cannot fail silently
- Clickable member-action buttons instead of typed prompt commands
- Existing `Eden's Viper` accounts are automatically restored to owner status

## Environment variables

- `OWNER_PASSWORD` - required for owner login
- `OWNER_USERNAME` - defaults to `Eden's Viper`
- `SESSION_SECRET` - strongly recommended; use a long random value so sessions survive restarts
- `DATA_DIR` - defaults to local `data`; Render blueprint uses `/var/data`
- `ROOM_KICK_MINUTES` - defaults to 10
- `MAX_UPLOAD_MB` - defaults to 5, capped at 10

## Render

This project must replace all current files in the same GitHub repository used by your existing Render service. Keep a persistent Render disk mounted at `/var/data` if you want accounts/messages/uploads to survive redeploys. After deployment, the header must say `SERVER v6 READY`.

## Important media note

The current WebRTC system is peer-to-peer and uses public STUN servers. For larger rooms or restrictive networks, add TURN and later an SFU such as LiveKit, mediasoup, Janus, or similar.
