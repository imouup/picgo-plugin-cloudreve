# picgo-plugin-cloudreve

PicGo uploader plugin for using Cloudreve v3/v4 as an image host. The plugin uploads files through Cloudreve WebDAV, then calls Cloudreve's own "get direct link" API so PicGo receives the same direct link that Cloudreve would generate in its web UI.

## Why WebDAV + direct link API

Cloudreve v3 and v4 both provide WebDAV access. WebDAV credentials are independent from normal login passwords and can be kept in PicGo for unattended uploads.

Cloudreve WebDAV accounts can also be bound to a relative root directory. After binding, this plugin can only upload inside that root, and the `remotePath` setting becomes a subdirectory below it.

The final image URL is **not** guessed by concatenating a custom prefix. After each upload, the plugin asks Cloudreve to create or return the file's direct link:

- Cloudreve v4: `PUT /api/v4/file/source` with `uris: ["cloudreve://my/..."]`.
- Cloudreve v3: list the uploaded directory to find the file ID, then `POST /api/v3/file/source` with `items: [...]`.

## Install

```bash
picgo install cloudreve
```

For local development:

```bash
git clone <this-repo>
cd picgo-plugin-cloudreve
npm test
```

## PicGo configuration

Select `Cloudreve` as the uploader and fill in these fields:

| Field | Required | Example | Description |
| --- | --- | --- | --- |
| `serverUrl` | Yes | `https://cloud.example.com` | Cloudreve site origin. Do not include `/dav` here unless your site is actually mounted under a subpath. |
| `username` | Yes | `me@example.com` | Cloudreve WebDAV username, usually the account email. |
| `password` | Yes | `cloudreve-generated-password` | Cloudreve generated WebDAV password. |
| `davPath` | Yes | `/dav` | WebDAV endpoint path. Cloudreve commonly uses `/dav`. |
| `remotePath` | No | `Pictures/PicGo` | Upload directory relative to the WebDAV root or the bound WebDAV account root. The plugin creates missing folders with `MKCOL`. |
| `apiVersion` | Yes | `v4` | Select `v4` or `v3` for the Cloudreve direct link API. |
| `apiToken` | v4 only | `eyJ...` | Cloudreve v4 Bearer Token/JWT used by `PUT /api/v4/file/source`. You may paste either the raw token or `Bearer <token>`. |
| `sessionCookie` | v3 only | `cloudreve-session=...` | Cloudreve v3 logged-in session cookie used by directory listing and `POST /api/v3/file/source`. |
| `fileUriPrefix` | v4 only | `cloudreve://my` | Prefix used to build v4 file URIs. If your WebDAV account is bound to a Cloudreve root such as `Pictures`, set this to `cloudreve://my/Pictures`. |
| `timeout` | No | `30000` | Request timeout in milliseconds. |
| `rename` | No | `true` | Add timestamp and index before original filename to avoid overwriting existing files. |

### Cloudreve v4 example

```json
{
  "picBed": {
    "current": "cloudreve",
    "cloudreve": {
      "serverUrl": "https://cloud.example.com",
      "username": "me@example.com",
      "password": "your-webdav-password",
      "davPath": "/dav",
      "remotePath": "PicGo",
      "apiVersion": "v4",
      "apiToken": "your-cloudreve-v4-jwt-or-api-token",
      "fileUriPrefix": "cloudreve://my/Pictures",
      "timeout": 30000,
      "rename": true
    }
  }
}
```

In the example above, the WebDAV account is assumed to be bound to the Cloudreve `Pictures` directory, so uploading to WebDAV `PicGo/cat.png` maps to the v4 file URI `cloudreve://my/Pictures/PicGo/cat.png`.

### Cloudreve v3 example

```json
{
  "picBed": {
    "current": "cloudreve",
    "cloudreve": {
      "serverUrl": "https://cloud.example.com",
      "username": "me@example.com",
      "password": "your-webdav-password",
      "davPath": "/dav",
      "remotePath": "Pictures/PicGo",
      "apiVersion": "v3",
      "sessionCookie": "cloudreve-session=your-session-cookie",
      "timeout": 30000,
      "rename": true
    }
  }
}
```

Cloudreve v3's source API accepts file IDs instead of paths. The plugin therefore lists `remotePath` after upload, finds the uploaded file by name, and sends its ID to Cloudreve's source API.

## Upload flow

1. Read files from PicGo's transformed output or input file paths.
2. Create the configured `remotePath` recursively via WebDAV `MKCOL`.
3. Upload each image with WebDAV `PUT` and Basic authentication.
4. Call Cloudreve's direct link API for the uploaded file.
5. Return PicGo output items with `imgUrl` set to the Cloudreve-generated direct link, plus `fileName`, `extname`, and `type: "cloudreve"`.

## Development

```bash
npm test
npm run lint
```

The implementation has no runtime dependencies beyond Node.js built-in modules.

## Notes

- Keep WebDAV passwords, v4 tokens, and v3 session cookies secret; do not commit them to this repository.
- Prefer creating a dedicated Cloudreve WebDAV account and binding it to a narrow root directory.
- For v4, make sure `fileUriPrefix + remotePath + filename` matches the actual Cloudreve file URI, otherwise the direct link API cannot find the uploaded file.
- Cloudreve group settings must allow source/direct link creation for the account used by the API token or session cookie.
