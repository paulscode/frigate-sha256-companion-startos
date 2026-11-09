ARCHES := x86 arm
# overrides to s9pk.mk must precede the include statement
include node_modules/@start9labs/start-sdk/s9pk.mk

# The Dockerfile copies patches/, which the SDK's ingredient list leaves out: without this, a changed
# patch would leave an existing s9pk "up to date" and it would be repacked as the new build.
$(BASE_NAME).s9pk $(BASE_NAME)_x86_64.s9pk $(BASE_NAME)_aarch64.s9pk: $(wildcard patches/*)
