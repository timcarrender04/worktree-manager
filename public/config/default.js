window.config = {
  routerBasename: '/',

  extensions: [
    '@ohif/extension-default',
    '@ohif/extension-cornerstone',
    '@ohif/extension-measurement-tracking',
    '@ohif/extension-cornerstone-dicom-sr',
    '@ohif/extension-cornerstone-dicom-rt',
    '@ohif/extension-cornerstone-dicom-seg',
    '@ohif/extension-dicom-pdf',
    '@ohif/extension-dicom-video',
  ],
  modes: [
    '@ohif/mode-basic-dev-mode',
    '@ohif/mode-longitudinal',
  ],

  customizationService: {},
  logo: React.createElement('img', {
    src: 'https://dyhm790r7zwqq.cloudfront.net/email-assets/sideline-surgeons-logo.png',
    alt: 'Sideline Surgeons',
    style: {
      height: '40px',
      width: 'auto',
      maxWidth: '200px',
      objectFit: 'contain'
    }
  })
}
