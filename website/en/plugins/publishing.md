# Publishing

Publish a Blue plugin as an ordinary npm Cordis package. Before publication:

- `package.json.exports` targets real JS and type files;
- `files` includes build output and `cordis.patch.yml`;
- dsh and Blue packages use appropriate peer dependencies;
- the tarball independently installs and passes tests in an empty directory;
- README documents install, injected services, unload behavior, and profile
  acceptance;
- package name, version, tag, access, provenance, and 2FA are explicit.

```sh
npm pack
npm publish --access public
```

Publish only after explicit authorization for the exact package, version, and
tag. GitHub repository creation and npm publication are separate actions. See
the [marketplace submission guide](/en/marketplace/submit).
