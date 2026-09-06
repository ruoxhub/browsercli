/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * 移植自 anything-analyzer (MIT License):
 * open-source/anything-analyzer/src/main/proxy/ca-manager.ts
 */
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as tls from 'node:tls';

import forge from 'node-forge';

import {getEnvValue} from '../../config/resolver.js';

const CA_KEY_FILE = 'ca-key.pem';
const CA_CERT_FILE = 'ca-cert.pem';
const CA_VALIDITY_YEARS = 10;
// Chrome / Chromium / Firefox / iOS / Android 自 2020-09 起统一上限 398 天。
// 留缓冲避免边界期 cert 被拒。
const LEAF_VALIDITY_DAYS = 365;
const CACHE_MAX_SIZE = 500;

/** 证书目录：BROWSER_MITM_CERTS_DIR 或 ~/.proxycli/mitm-certs。 */
export function resolveMitmCertsDir(): string {
  const explicit = getEnvValue('BROWSER_MITM_CERTS_DIR');
  if (explicit && explicit.trim().length > 0) return explicit;
  return path.join(os.homedir(), '.proxycli', 'mitm-certs');
}

interface KeyPairLike {
  privateKey: forge.pki.rsa.PrivateKey;
  publicKey: forge.pki.rsa.PublicKey;
}

/**
 * CaManager — 生成并缓存根 CA，并按域名签发叶子证书用于 MITM TLS 拦截。
 */
export class CaManager {
  private caKey: KeyPairLike | null = null;
  private caCert: forge.pki.Certificate | null = null;
  /** LRU 缓存：hostname → tls.SecureContext */
  private readonly contextCache = new Map<string, tls.SecureContext>();

  constructor(private readonly certsDir: string) {}

  async init(): Promise<void> {
    if (!existsSync(this.certsDir)) {
      mkdirSync(this.certsDir, {recursive: true});
    }
    const keyPath = path.join(this.certsDir, CA_KEY_FILE);
    const certPath = path.join(this.certsDir, CA_CERT_FILE);
    if (existsSync(keyPath) && existsSync(certPath)) {
      const keyPem = readFileSync(keyPath, 'utf-8');
      const certPem = readFileSync(certPath, 'utf-8');
      const privateKey = forge.pki.privateKeyFromPem(keyPem);
      this.caKey = {
        privateKey,
        publicKey: forge.pki.setRsaPublicKey(privateKey.n, privateKey.e),
      };
      this.caCert = forge.pki.certificateFromPem(certPem);
    } else {
      this.generate();
    }
  }

  isInitialized(): boolean {
    return this.caCert !== null && this.caKey !== null;
  }

  getCaCertPath(): string {
    return path.join(this.certsDir, CA_CERT_FILE);
  }

  getCaCertDer(): Buffer {
    if (!this.caCert) throw new Error('CA not initialized');
    const asn1 = forge.pki.certificateToAsn1(this.caCert);
    const der = forge.asn1.toDer(asn1);
    return Buffer.from(der.getBytes(), 'binary');
  }

  getSecureContextForHost(hostname: string): tls.SecureContext {
    const cached = this.contextCache.get(hostname);
    if (cached) return cached;

    if (this.contextCache.size >= CACHE_MAX_SIZE) {
      const oldest = this.contextCache.keys().next().value!;
      this.contextCache.delete(oldest);
    }

    const {key, cert} = this.issueLeafCert(hostname);
    const ctx = tls.createSecureContext({
      key,
      cert,
      ca: forge.pki.certificateToPem(this.caCert!),
    });
    this.contextCache.set(hostname, ctx);
    return ctx;
  }

  async regenerate(): Promise<void> {
    this.contextCache.clear();
    this.generate();
  }

  private generate(): void {
    const keys = forge.pki.rsa.generateKeyPair({bits: 2048});
    this.caKey = {privateKey: keys.privateKey, publicKey: keys.publicKey};

    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = this.randomSerial();

    const now = new Date();
    cert.validity.notBefore = now;
    cert.validity.notAfter = new Date(
      now.getFullYear() + CA_VALIDITY_YEARS,
      now.getMonth(),
      now.getDate(),
    );

    const attrs: forge.pki.CertificateField[] = [
      {shortName: 'CN', value: 'BrowserCLI MITM CA'},
      {shortName: 'O', value: 'BrowserCLI'},
    ];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);

    cert.setExtensions([
      {name: 'basicConstraints', cA: true, critical: true},
      {name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true},
      {name: 'subjectKeyIdentifier'},
    ]);

    cert.sign(keys.privateKey, forge.md.sha256.create());
    this.caCert = cert;

    const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
    const certPem = forge.pki.certificateToPem(cert);
    writeFileSync(path.join(this.certsDir, CA_KEY_FILE), keyPem, 'utf-8');
    writeFileSync(path.join(this.certsDir, CA_CERT_FILE), certPem, 'utf-8');
  }

  private issueLeafCert(hostname: string): {key: string; cert: string} {
    if (!this.caKey || !this.caCert) {
      throw new Error('CA not initialized');
    }

    const keys = forge.pki.rsa.generateKeyPair({bits: 2048});
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = this.randomSerial();

    const now = new Date();
    cert.validity.notBefore = now;
    cert.validity.notAfter = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + LEAF_VALIDITY_DAYS,
    );

    cert.setSubject([{shortName: 'CN', value: hostname}]);
    cert.setIssuer(this.caCert.subject.attributes);

    const isIP = /^[\d.]+$/.test(hostname) || hostname.includes(':');
    const altNames: Array<{type: number; value?: string; ip?: string}> = isIP
      ? [{type: 7, ip: hostname}]
      : [{type: 2, value: hostname}];

    cert.setExtensions([
      {name: 'basicConstraints', cA: false},
      {name: 'keyUsage', digitalSignature: true, keyEncipherment: true},
      {name: 'extKeyUsage', serverAuth: true},
      {name: 'subjectAltName', altNames},
      {name: 'subjectKeyIdentifier'},
      {
        name: 'authorityKeyIdentifier',
        // AKI 必须等于 CA 的 SKI；keyIdentifier:true 会错用叶子自身公钥，
        // 导致 Android CertPathValidator 判定 trust anchor 不匹配。
        keyIdentifier: this.caCert.generateSubjectKeyIdentifier().getBytes(),
      },
    ]);

    cert.sign(this.caKey.privateKey, forge.md.sha256.create());

    const leafPem = forge.pki.certificateToPem(cert);
    const caPem = forge.pki.certificateToPem(this.caCert);
    return {
      key: forge.pki.privateKeyToPem(keys.privateKey),
      cert: leafPem + caPem,
    };
  }

  private randomSerial(): string {
    return forge.util.bytesToHex(forge.random.getBytesSync(16));
  }
}
