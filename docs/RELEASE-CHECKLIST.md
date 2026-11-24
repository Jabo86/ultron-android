# Release acceptance checklist

Use this checklist per component and version. Record evidence; do not mark a check as passed without results.

- [ ] Channel and version identified; exact source commit recorded.
- [ ] Changes reviewed, dependency licenses and attributions included.
- [ ] Build and static tests pass; failures documented.
- [ ] Real-device installation and upgrade tests completed; data-preservation behavior recorded.
- [ ] Component-specific integration, failure and regression tests completed.
- [ ] Signing certificate verified against trusted release identity; no private key in artifacts.
- [ ] SHA-256 calculated from the final uploaded APK and independently compared.
- [ ] Release notes specify supported devices, known limitations and test status.
- [ ] Privacy and security claims match evidence.
- [ ] Download links and channel labels verified; pilot does not replace stable unintentionally.
- [ ] Maintainer approves publication.

The existing main-branch workflow can publish an APK when signing settings are present. Review release automation before merging even documentation-only changes.
