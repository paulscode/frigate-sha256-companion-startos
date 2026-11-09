# Frigate, built from upstream source with this package's patches and a BLAKE2b-aware drongo, laid
# over the community image (ghcr.io/remcoros/frigate-docker), whose entrypoint and Intel OpenCL
# runtime it keeps. The approach follows BitcoinMechanic/frigate-startos.
#
# Every input is pinned: the base and builder images by digest, the Frigate and drongo sources by
# commit and by the SHA256 of GitHub's archive of that commit. UPDATING.md says how to move a pin.
ARG BASE_IMAGE=ghcr.io/remcoros/frigate-docker:1.6.1@sha256:218cc79bdcd300651f516d3e40ae43dcc48763329f223133c9d606f039c22f8b

# Sources: downloaded, verified, unpacked and patched on the build machine's own architecture. They
# are the same for every target, and unpacking under emulation fails on some hosts (tar: "Cannot
# mkdir: Function not implemented" in an arm64 build on x86_64).
FROM --platform=$BUILDPLATFORM eclipse-temurin:25-jdk@sha256:83f4a7fc27df94dcc7b8de04d14cbbba8da14406f921e966969c3b09000aa507 AS sources

# sparrowwallet/frigate tag 1.6.1
ARG FRIGATE_COMMIT=f516f285f4f684328a867ea906267ba766f0b2c6
ARG FRIGATE_SHA256=a51404339247f94edf191c5b4196d9e397a4b6d9cd4fdde6344e4a957488540a
# paulscode/drongo branch blake2b: header v2 parsing and the BLAKE2b block hash
ARG DRONGO_COMMIT=f94580aff6072734f5af758526b2f35d80562bbe
ARG DRONGO_SHA256=02a97840d8fc4835264b1676ff161337001243a90f72c8f8d1a197dc85cce7c4

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl patch \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN curl --fail --location --silent --show-error --output frigate.tar.gz \
      "https://github.com/sparrowwallet/frigate/archive/${FRIGATE_COMMIT}.tar.gz" \
    && echo "${FRIGATE_SHA256}  frigate.tar.gz" | sha256sum --check --strict \
    && curl --fail --location --silent --show-error --output drongo.tar.gz \
      "https://github.com/paulscode/drongo/archive/${DRONGO_COMMIT}.tar.gz" \
    && echo "${DRONGO_SHA256}  drongo.tar.gz" | sha256sum --check --strict \
    && mkdir frigate drongo \
    && tar --extract --gzip --file frigate.tar.gz --directory frigate --strip-components=1 \
    && tar --extract --gzip --file drongo.tar.gz --directory drongo --strip-components=1 \
    && rm -rf frigate/drongo && mv drongo frigate/drongo \
    && rm frigate.tar.gz drongo.tar.gz

COPY patches/ /tmp/patches/
WORKDIR /src/frigate
# A patch that does not apply exactly is a build failure, never a fuzzy guess.
RUN set -e; ls /tmp/patches/*.patch >/dev/null; \
    for p in /tmp/patches/*.patch; do echo "applying $p"; patch --strip=1 --fuzz=0 --forward < "$p"; done

FROM eclipse-temurin:25-jdk@sha256:83f4a7fc27df94dcc7b8de04d14cbbba8da14406f921e966969c3b09000aa507 AS builder
COPY --from=sources /src/frigate /src/frigate
WORKDIR /src/frigate
# The launcher script runs bin/java, which jlink's --strip-native-commands would leave out.
RUN grep --quiet --fixed-strings "'--strip-native-commands'" build.gradle \
    && sed --in-place "s/'--strip-native-commands', //" build.gradle
# Gradle itself, fetched first and retried: GitHub's release downloads fail now and then (504), and
# that should not fail a release build.
RUN for i in 1 2 3 4 5; do ./gradlew --no-daemon --version >/dev/null && exit 0; echo "gradle download failed, retrying"; sleep 20; done; exit 1
# The tests run on the native build only: under emulation they would take hours, and the code is the
# same on both architectures.
RUN if [ "$(uname -m)" = x86_64 ]; then ./gradlew --no-daemon clean test jlink; else ./gradlew --no-daemon clean jlink; fi

FROM ${BASE_IMAGE}
# Replace the stock application wholesale, so nothing of upstream's .deb build lingers beside ours.
RUN rm -rf /opt/frigate
COPY --from=builder /src/frigate/build/image /opt/frigate
# The jlink launcher runs java as a child of its shell, so a stop signal reaches only the shell and
# Frigate keeps running (a StartOS stop or update then waits on it). exec hands the process to java.
RUN grep -q '^"\$DIR/java" ' /opt/frigate/bin/frigate \
    && sed -i 's|^"\$DIR/java" |exec "$DIR/java" |' /opt/frigate/bin/frigate \
    && grep -q '^exec "\$DIR/java" ' /opt/frigate/bin/frigate
