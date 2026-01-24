# Extension Self-Hosting Guide

This document explains how the Chessr extension is self-hosted with automatic updates, without using the Chrome Web Store.

## How Chrome Extension Auto-Update Works

1. The extension's `manifest.json` contains an `update_url` field pointing to your server
2. Chrome periodically checks this URL (every few hours) for updates
3. The server responds with an XML manifest containing the latest version number
4. If a newer version is available, Chrome downloads and installs the `.crx` file automatically

## Architecture

```
extension.chessr.io
    |
    +-- /updates.xml      <- Chrome checks this for new versions
    +-- /chessr.crx       <- The signed extension package
```

## Server Directory Structure

On the server, create the following directory:

```
/opt/chess-server/extension/
    |
    +-- updates.xml       # XML manifest with version info
    +-- chessr.crx        # Signed extension package
    +-- key.pem           # Private signing key (KEEP SECURE!)
```

## The Signing Key (key.pem)

### What is it?

The `key.pem` file is a 2048-bit RSA private key used to sign the extension. It's critical because:

- **It determines the Extension ID** - The same key always produces the same extension ID
- **It proves authenticity** - Chrome verifies updates come from the same publisher
- **It enables auto-updates** - Without matching signatures, Chrome won't update

### Generating the Key (One-Time)

```bash
cd extension/
openssl genrsa -out key.pem 2048
```

### Where to Store It

**DO NOT commit key.pem to git!**

Store it in:
1. **Local development**: `extension/key.pem` (already in .gitignore)
2. **Server**: `/opt/chess-server/extension/key.pem`
3. **Backup**: Store securely (password manager, encrypted backup)

If you lose this key, you cannot push updates to existing users - they would need to reinstall the extension manually.

## Releasing a New Version

### Step 1: Update Version Number

Edit `extension/public/manifest.json`:
```json
{
  "version": "1.0.2",  // Bump this
  ...
}
```

### Step 2: Build and Sign

```bash
cd extension/
npm run sign
# Or manually:
# npm run build && npx crx3 dist -o chessr.crx -p key.pem
```

This creates `chessr.crx` in the extension directory.

### Step 3: Update Server Files

Copy to server:
```bash
scp chessr.crx root@your-server:/opt/chess-server/extension/
```

Update `updates.xml` on server with the new version:
```xml
<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='YOUR_EXTENSION_ID'>
    <updatecheck codebase='https://extension.chessr.io/chessr.crx' version='1.0.2' />
  </app>
</gupdate>
```

### Step 4: Update Server Version Check

Also update `server/src/version-config.ts`:
```typescript
export const versionConfig = {
  minVersion: '1.0.2',  // Update this to force upgrades
  downloadUrl: 'https://extension.chessr.io/chessr.crx',
};
```

## Finding Your Extension ID

The Extension ID is derived from the signing key. To find it:

1. Build and sign the extension: `npm run sign`
2. In Chrome, go to `chrome://extensions`
3. Enable "Developer mode"
4. Drag and drop `chessr.crx` onto the page
5. The extension ID is shown (e.g., `abcdefghijklmnopqrstuvwxyz123456`)

Use this ID in your `updates.xml` file.

## updates.xml Format

```xml
<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='YOUR_EXTENSION_ID_HERE'>
    <updatecheck
      codebase='https://extension.chessr.io/chessr.crx'
      version='1.0.1'
    />
  </app>
</gupdate>
```

- `appid`: Your extension's ID (32 lowercase letters)
- `codebase`: URL to the .crx file
- `version`: Current version available on server

## SSL Certificate Setup

Chrome requires HTTPS for extension updates. Set up SSL for extension.chessr.io:

```bash
# On server, run certbot
certbot certonly --nginx -d extension.chessr.io

# Certificates will be in:
# /etc/letsencrypt/live/extension.chessr.io/fullchain.pem
# /etc/letsencrypt/live/extension.chessr.io/privkey.pem
```

## First-Time Installation

Users must install the extension manually the first time:

1. **Developer Mode**:
   - Open `chrome://extensions`
   - Enable "Developer mode"
   - Click "Load unpacked" and select the `extension/dist` folder

2. **Or drag-and-drop CRX**:
   - Download `chessr.crx` from `https://extension.chessr.io/chessr.crx`
   - Drag it onto `chrome://extensions`

After first install, Chrome will auto-update from your server.

## Troubleshooting

### Extension not updating

- Check Chrome's update frequency (every few hours)
- Force check: Restart Chrome or go to `chrome://extensions` and click "Update"
- Verify `updates.xml` is accessible: `curl https://extension.chessr.io/updates.xml`
- Ensure version in `updates.xml` is higher than installed version

### "This extension is not from Chrome Web Store"

- This warning is normal for self-hosted extensions
- Users need Developer Mode enabled to install

### Extension ID changed

- You're using a different signing key
- Users with the old extension won't receive updates
- They need to uninstall and reinstall

### CORS errors

- The nginx config includes `Access-Control-Allow-Origin *`
- Verify nginx is reloaded after config changes

## Security Notes

1. **Protect key.pem** - Anyone with this key can push malicious updates
2. **Use HTTPS** - Chrome requires it for update_url
3. **Version control** - Always increment version when releasing
4. **Backup key** - Losing it means losing update capability
