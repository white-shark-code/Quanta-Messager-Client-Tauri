export interface ReauthArgs {
    /** The keystore's owning userId — used to scope the re-encrypt. */
    userId: string;
    /** The passphrase that decrypts the ChaCha20 container on disk. */
    keystorePassphrase: string;
    /**
     * Optional passphrase for the PGP private key packet itself. Defaults
     * to `keystorePassphrase` when omitted (typical case).
     */
    pgpPassphrase?: string;
    /** Server password — re-authorized against `/auth/login`. */
    serverPassword: string;
}
export declare function reauth(args: ReauthArgs): Promise<void>;
