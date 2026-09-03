# ChefVoice 0.11.1 — Second-Pass Storage Bucket Hotfix

## Fixed
The Firebase Admin runtime was initialized without a default Storage bucket.
This caused:

`Bucket name not specified or invalid.`

The function now explicitly uses:

`chefvoice-d7fec.firebasestorage.app`

in both Admin initialization and `getStorage().bucket(...)`.

## Deploy
Because this changes the Cloud Function:

```bat
cd functions
npm install
cd ..
firebase deploy --only functions,hosting --project chefvoice-d7fec
```

The existing Cloud Run `--no-invoker-iam-check` setting should remain in place.
