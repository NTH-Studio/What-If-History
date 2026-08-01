import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import styles from '../styles/App.module.css';

export function StudioSupport() {
  const { t } = useTranslation();

  return (
    <footer
      className={styles.studioSupport}
      aria-label={t('studioSupport.ariaLabel')}
      data-testid="studio-support"
    >
      <a
        className={styles.studioSignature}
        href="https://nthstudio.eu"
        target="_blank"
        rel="noreferrer"
        aria-label={t('studioSupport.visit')}
      >
        <img
          className={styles.studioLogo}
          src="/branding/logo_nthstudio.png"
          alt=""
          aria-hidden="true"
        />
        <span className={styles.studioCopy}>
          <small>{t('studioSupport.projectBy')}</small>
          <strong>NTH Studio</strong>
        </span>
        <ExternalLink className={styles.studioExternalIcon} size={15} aria-hidden="true" />
      </a>

      <a
        className={styles.kofiLink}
        href="https://ko-fi.com/nthstudio"
        target="_blank"
        rel="noreferrer"
      >
        <img src="/branding/logo_kofi.svg" alt="" aria-hidden="true" />
        <span>{t('studioSupport.support')}</span>
        <ExternalLink size={15} aria-hidden="true" />
      </a>
    </footer>
  );
}
