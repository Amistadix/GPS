# HEC QC Department Gateway

GitHub Pages serves the landing page at https://hec.zhegov.com. Firebase Authentication verifies Google accounts, including personal Gmail accounts. The project directory and grants are held in a dedicated Cloud Firestore database.

## Configure the gateway

1. In a Firebase project dedicated to this portal, register a Web app and copy its public configuration object to `gateway-config.js`.
2. Enable Google in Authentication → Sign-in method and add `hec.zhegov.com` to Authorized domains. Select the project's support email. For staging, register the staging origin as well.
3. Create the default Cloud Firestore database. Publish the supplied rules before testing, using `firebase deploy --only firestore:rules --project YOUR_GATEWAY_PROJECT_ID`. This publishes the ruleset for that database, so use the dedicated portal project.
4. Sign in once with Kiril's Google account on the configured portal. Check the verified email and exact UID in Firebase Authentication. In the Firebase console create the document `gatewayAdmins/<that UID>` with a field `enabled: true`. Only a cloud administrator can bootstrap or remove administrators. Delete this document to remove the administrator role.
5. Sign out and back in. The administrator's project directory starts with Promina South. Add future projects using an HTTPS application URL. For employee access, enter the Google email, choose the project and save. An empty set of editing permissions grants read-only access. Removing the grant removes the project from this employee's portal.

## Acceptance before switching the domain

Use a verified administrator and a second Google account. Check sign-in, an initially empty employee directory view, grant and revoke access, reload, and sign out. Confirm that the employee cannot list other accounts or change grants. Merge the tested branch into the existing GitHub Pages publishing branch. The existing CNAME stays in place.

The gateway controls its directory and records selected editing permissions. Each linked application's own backend controls data and editing. Promina GPS continues using its existing ChatGPT Sites access and inspection history.
