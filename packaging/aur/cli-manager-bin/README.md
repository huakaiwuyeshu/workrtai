# cli-manager-bin AUR package

This directory is the upstream template for the separate AUR package repository.

Release steps for V1.2.7:

1. Copy `PKGBUILD.template` to `PKGBUILD`.
2. Replace `@DEB_SHA256@` with the SHA-256 of `CLI-Manager_1.2.7_amd64.deb`.
3. Run `makepkg --cleanbuild --syncdeps --install` on Arch Linux.
4. Run `namcap PKGBUILD cli-manager-bin-*.pkg.tar.zst` and correct dependency warnings.
5. Run `makepkg --printsrcinfo > .SRCINFO`, then publish the AUR repository.

The wrapper marks the installation as AUR-managed so CLI-Manager does not bypass pacman with its built-in updater.
