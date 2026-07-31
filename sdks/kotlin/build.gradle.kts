plugins {
    kotlin("jvm") version "2.1.0"
    `java-library`
    `maven-publish`
}

group = "id.openagent"
version = "0.1.0"

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(17))
    }
    withSourcesJar()
    withJavadocJar()
}

repositories {
    mavenCentral()
}

dependencies {
    // The JDK carries Ed25519/X25519 signature verification (EdDSA, Java
    // 15+). BouncyCastle covers public-key derivation for key custody, which
    // the JDK exposes only through internal APIs. CBOR is decoded by a
    // scoped decoder in this package, so no codec dependency is needed.
    implementation("org.bouncycastle:bcprov-jdk18on:1.79")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")

    // Ktor server plugin (optional integration for route verification).
    implementation("io.ktor:ktor-server-core-jvm:3.0.1")

    testImplementation(kotlin("test"))
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
}

kotlin {
    explicitApi()
}

tasks.test {
    useJUnitPlatform()
}

publishing {
    publications {
        create<MavenPublication>("maven") {
            from(components["java"])
            pom {
                name.set("OpenAgent SDK for Kotlin")
                description.set(
                    "Identity, authentication, and Agent Capability Token verification for autonomous agents."
                )
                url.set("https://openagent.id")
                licenses {
                    license {
                        name.set("Apache-2.0 OR MIT")
                    }
                }
            }
        }
    }
}
