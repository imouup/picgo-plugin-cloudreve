# picgo-plugin-cloudreve

PicGo uploader plugin for using Cloudreve v3/v4 as an image host. The plugin uploads files through Cloudreve WebDAV, which gives a simple and long-lived authentication flow and lets you bind uploads to a fixed directory.

## Why WebDAV

Cloudreve v3 and v4 both provide WebDAV access. Compared with short-lived web sessions or version-specific REST upload sessions, WebDAV credentials are easier to keep in PicGo and are suitable for long-term unattended uploads.

Cloudreve WebDAV accounts are independent from normal login passwords. Create a dedicated WebDAV account in Cloudreve, copy the generated password, and optionally bind that WebDAV account to a relative root directory. After binding, this plugin can only see and upload inside that root, and the `remotePath` setting becomes a subdirectory below it.

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
| `publicUrlPrefix` | No | `https://img.example.com/Pictures/PicGo` | Public URL prefix used to construct PicGo `imgUrl`. |
| `publicUrlTemplate` | No | `https://cdn.example.com/{path}` | Advanced public URL template. Overrides `publicUrlPrefix`. Supports `{path}`, `{rawPath}`, `{filename}`, and `{rawFilename}`. |
| `timeout` | No | `30000` | Request timeout in milliseconds. |
| `rename` | No | `true` | Add timestamp and index before original filename to avoid overwriting existing files. |

Example PicGo config snippet:

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
      "publicUrlPrefix": "https://img.example.com/Pictures/PicGo",
      "timeout": 30000,
      "rename": true
    }
  }
}
```

## URL generation

Cloudreve's WebDAV upload endpoint is not necessarily the same as the public image URL. Configure one of the following according to your Cloudreve deployment:

1. **`publicUrlPrefix`**: appends the encoded uploaded path to a fixed prefix.
2. **`publicUrlTemplate`**: gives full control over the final URL. Placeholders:
   - `{path}`: URL-encoded remote path without the leading slash.
   - `{rawPath}`: raw remote path without the leading slash.
   - `{filename}`: URL-encoded filename.
   - `{rawFilename}`: raw filename.
3. If both are empty, the plugin falls back to `serverUrl + encoded remote path`.

## Upload flow

1. Read files from PicGo's transformed output or input file paths.
2. Create the configured `remotePath` recursively via WebDAV `MKCOL`.
3. Upload each image with WebDAV `PUT` and Basic authentication.
4. Return PicGo output items with `imgUrl`, `fileName`, `extname`, and `type: "cloudreve"`.

## Development

```bash
npm test
npm run lint
```

The implementation has no runtime dependencies beyond Node.js built-in modules.

## Notes

- Keep the WebDAV password secret; do not commit it to this repository.
- Prefer creating a dedicated Cloudreve WebDAV account and binding it to a narrow root directory.
- If the final image URL requires a Cloudreve share link or CDN rewrite, use `publicUrlTemplate`.
