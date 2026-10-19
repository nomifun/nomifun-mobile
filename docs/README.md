# Mobile technical documents

This folder contains implementation contracts and development notes. Product
installation and usage guides belong to NomiFun Portal.

[Mobile 与 Desktop 协议对接说明](DESKTOP-PROTOCOL-ALIGNMENT.md) records the
current model-management contract, the wider API audit, and isolated local
verification commands.

[Android 官方 APK 更新与发布](APP-UPDATES.md) describes the independent update
feed, verified APK manifest tools, release ordering and device acceptance.

`screenshots/` holds the product gallery embedded in the root README. Refresh
it with `NOMI_E2E_SHOTS=docs/screenshots node e2e/readme-shots.mjs` against a
live desktop backend — captures must show the running product, not mockups.
