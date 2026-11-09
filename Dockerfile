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
# Exactly the patches listed in patches/SHA256SUMS (written by tools/export-patches.sh), in that
# order, each matching its checksum: a stale file left from an earlier export, or one edited by hand,
# fails the build rather than being applied. A patch that does not apply exactly is a failure too,
# never a fuzzy guess.
RUN set -e; cd /tmp/patches; sha256sum --check --strict SHA256SUMS; \
    listed=$(awk '{print $2}' SHA256SUMS | sort); present=$(ls *.patch | sort); \
    [ "$listed" = "$present" ] || { echo "patches/ and patches/SHA256SUMS disagree" >&2; exit 1; }; \
    cd /src/frigate; for p in $(awk '{print $2}' /tmp/patches/SHA256SUMS); do \
      echo "applying $p"; patch --strip=1 --fuzz=0 --forward < "/tmp/patches/$p"; done
# Gradle itself (the zip is the same for every target), fetched once here and retried for several
# minutes: GitHub's release downloads fail now and then (504), and that should not fail a release.
# The zip is checked against Gradle's published SHA256 (gradle-9.1.0-bin.zip.sha256): a move of the
# wrapper's version fails here until this is updated with it.
RUN grep -q 'gradle-9.1.0-bin.zip' gradle/wrapper/gradle-wrapper.properties \
    && echo 'distributionSha256Sum=a17ddd85a26b6a7f5ddb71ff8b05fc5104c0202c6e64782429790c933686c806' >> gradle/wrapper/gradle-wrapper.properties
RUN for i in $(seq 1 12); do ./gradlew --no-daemon --version >/dev/null && exit 0; echo "gradle download failed, retrying"; sleep 30; done; exit 1

FROM eclipse-temurin:25-jdk@sha256:83f4a7fc27df94dcc7b8de04d14cbbba8da14406f921e966969c3b09000aa507 AS builder
COPY --from=sources /src/frigate /src/frigate
COPY --from=sources /root/.gradle/wrapper /root/.gradle/wrapper
WORKDIR /src/frigate
# The launcher script runs bin/java, which jlink's --strip-native-commands would leave out.
RUN grep --quiet --fixed-strings "'--strip-native-commands'" build.gradle \
    && sed --in-place -E "s/'--strip-native-commands',? ?//" build.gradle \
    && ! grep --quiet --fixed-strings "'--strip-native-commands'" build.gradle
# The libraries, from Maven Central and the Gradle plugin portal, fetched before the build and retried
# like the Gradle zip: a failed download is then a retry, not a failed release.
RUN for i in $(seq 1 6); do ./gradlew --no-daemon dependencies :drongo:dependencies >/dev/null && exit 0; echo "dependency download failed, retrying"; sleep 30; done; exit 1
# The tests run on the native build only (the build machine's own architecture): under emulation they
# would take hours, and the code is the same on both. A build with no native leg says so loudly.
ARG BUILDPLATFORM
ARG TARGETPLATFORM
RUN if [ -z "$TARGETPLATFORM" ] || [ "$BUILDPLATFORM" = "$TARGETPLATFORM" ]; then ./gradlew --no-daemon clean test jlink; \
    else echo "TESTS SKIPPED for $TARGETPLATFORM (emulated on $BUILDPLATFORM): they ran on the native build"; ./gradlew --no-daemon clean jlink; fi

FROM ${BASE_IMAGE}
# Replace the stock application wholesale, so nothing of upstream's .deb build lingers beside ours.
RUN rm -rf /opt/frigate
COPY --from=builder /src/frigate/build/image /opt/frigate
# The jlink launcher runs java as a child of its shell, so a stop signal reaches only the shell and
# Frigate keeps running (a StartOS stop or update then waits on it). exec hands the process to java.
RUN grep -q '^"\$DIR/java" ' /opt/frigate/bin/frigate \
    && sed -i 's|^"\$DIR/java" |exec "$DIR/java" |' /opt/frigate/bin/frigate \
    && grep -q '^exec "\$DIR/java" ' /opt/frigate/bin/frigate \
    && test -x /opt/frigate/bin/java
