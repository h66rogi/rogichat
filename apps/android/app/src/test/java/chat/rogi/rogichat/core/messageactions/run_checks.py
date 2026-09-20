#!/usr/bin/env python3
"""Bounded pure Kotlin regression runner; no Gradle/SDK/install/emulator.
Compiles owned core + exact source slices of existing StrictAuthJson and M11 DTOs.
Full app/network/Room/Compose assembly stays with the central integration writer.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = next(p for p in Path(__file__).resolve().parents if (p / 'settings.gradle.kts').exists())
MAIN = ROOT / 'app/src/main/java/chat/rogi/rogichat/core'
CACHE = Path(os.environ.get('GRADLE_USER_HOME', str(Path.home() / '.gradle'))) / 'caches/modules-2/files-2.1'
JAVA = Path(os.environ.get('JAVA_HOME', '/opt/homebrew/opt/openjdk')) / 'bin/java'

def jar(group, name, version):
    matches = sorted((CACHE / group / name / version).glob('*/' + name + '-' + version + '.jar'))
    if len(matches) != 1:
        raise SystemExit('Required cached dependency unavailable: ' + name + ':' + version)
    return str(matches[0])

stdlib = jar('org.jetbrains.kotlin', 'kotlin-stdlib', '2.0.21')
annotations = jar('org.jetbrains', 'annotations', '13.0')
compiler = [jar('org.jetbrains.kotlin', 'kotlin-compiler-embeddable', '2.0.21'), stdlib, annotations,
    jar('org.jetbrains.kotlin', 'kotlin-script-runtime', '2.0.21'),
    jar('org.jetbrains.kotlin', 'kotlin-reflect', '1.6.10'),
    jar('org.jetbrains.intellij.deps', 'trove4j', '1.0.20200330'),
    jar('org.jetbrains.kotlinx', 'kotlinx-coroutines-core-jvm', '1.6.4')]
classpath = [stdlib, annotations, jar('org.jetbrains.kotlinx', 'kotlinx-serialization-core-jvm', '1.7.3'),
    jar('org.jetbrains.kotlinx', 'kotlinx-serialization-json-jvm', '1.7.3'), jar('junit', 'junit', '4.13.2')]
with tempfile.TemporaryDirectory(prefix='message-actions-kotlin-') as directory:
    temp = Path(directory)
    auth = (MAIN / 'auth/SoopAuthContract.kt').read_text()
    (temp / 'StrictAuthJson.kt').write_text('package chat.rogi.rogichat.core.auth\nimport kotlinx.serialization.json.*\n' + auth[auth.index('internal object StrictAuthJson'):])
    m11 = (MAIN / 'network/M11Dtos.kt').read_text()
    (temp / 'M11Dtos.kt').write_text(m11[:m11.index('/** Meloming NotificationApi')])
    api = (MAIN / 'network/ApiClient.kt').read_text()
    invalid = next(line for line in api.splitlines() if line.startswith('class InvalidResponse'))
    (temp / 'InvalidResponse.kt').write_text('package chat.rogi.rogichat.core.network\n' + invalid)
    sources = [*sorted((MAIN / 'messageactions').glob('*.kt')), *sorted(temp.glob('*.kt')), Path(__file__).with_name('MessageActionChecks.kt')]
    output = temp / 'classes'
    subprocess.run([str(JAVA), '-Xmx512m', '-cp', os.pathsep.join(compiler), 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler',
        '-no-stdlib', '-no-reflect', '-jvm-target', '17', '-classpath', os.pathsep.join(classpath), '-d', str(output), *map(str, sources)], check=True)
    subprocess.run([str(JAVA), '-Xmx256m', '-cp', os.pathsep.join([str(output), *classpath]),
        'chat.rogi.rogichat.core.messageactions.MessageActionChecks'], check=True)
