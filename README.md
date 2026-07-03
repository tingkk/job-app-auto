# Job Application Autofill

Manifest V3 Chrome extension built with WXT, React, and TypeScript.

The extension keeps profile data, learned answers, and provider keys on the local device. It fills detected job application fields from structured profile data, saved answers, CV metadata, and answers learned from fields the user typed into on job application forms. Learned answers can be paused or deleted from the extension UI and are reused for matching questions across job application domains. It does not submit applications, navigate multi-page forms, generate unsaved free-text answers, solve CAPTCHAs, or bypass site controls.

## Development

```bash
npm install
npm run build
npm test
```

Load `.output/chrome-mv3` in Chrome's extension page during development.

## Support

If this extension saves you time, you can support development at [buymeacoffee.com/tingkk](https://buymeacoffee.com/tingkk).
