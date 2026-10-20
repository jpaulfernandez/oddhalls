# oddhalls

oddhalls is in beta. It turns a folder of photos into a finished book, in four stages: Cull · Develop · Design · Reels.
You cull a shoot down to the keepers, develop the RAW files, lay them out as a book or gallery, and cut a short reel.
It runs on your computer. Your photos stay in their folders, and it needs no account.
oddhalls is free to use. The source is not published during the beta.

## Download

| System | File |
| --- | --- |
| macOS, Apple silicon | [oddhalls-macos-arm64.dmg](https://github.com/jpaulfernandez/oddhalls/releases/latest/download/oddhalls-macos-arm64.dmg) |
| Windows, installer | [oddhalls-windows-x64-setup.exe](https://github.com/jpaulfernandez/oddhalls/releases/latest/download/oddhalls-windows-x64-setup.exe) |
| Windows, MSI | [oddhalls-windows-x64.msi](https://github.com/jpaulfernandez/oddhalls/releases/latest/download/oddhalls-windows-x64.msi) |
| Linux, AppImage | [oddhalls-linux-x64.AppImage](https://github.com/jpaulfernandez/oddhalls/releases/latest/download/oddhalls-linux-x64.AppImage) |
| Linux, deb | [oddhalls-linux-x64.deb](https://github.com/jpaulfernandez/oddhalls/releases/latest/download/oddhalls-linux-x64.deb) |

The macOS and Windows builds are not signed yet, so the first open shows a warning. The steps to get past it are in
the [install guide](https://oddhalls.janpaulfernandez.com/docs). The Windows and Linux builds are community-tested:
nobody has run every feature on them, so please report what breaks.

## Docs

[oddhalls.janpaulfernandez.com/docs](https://oddhalls.janpaulfernandez.com/docs)

## Bugs and ideas

Open an [issue](https://github.com/jpaulfernandez/oddhalls/issues/new/choose). Use Discussions for questions.
In the app, Help → Copy diagnostics gives you the block the bug form asks for.

## Share a book on the web

The viewer and the small Worker that counts likes are in [`web/viewer`](web/viewer) and [`web/worker`](web/worker).
Each release also attaches `oddhalls-web-<version>.zip` with both folders. [`web/README.md`](web/README.md) says how
to deploy them.

## Support

oddhalls is free. If it saves you time, you can help keep it going:
[oddhalls.janpaulfernandez.com/support](https://oddhalls.janpaulfernandez.com/support)

## Licence

[oddhalls beta licence](LICENSE).
