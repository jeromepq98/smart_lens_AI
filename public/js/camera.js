import { t } from './i18n.js';
import { openModal, toast, escapeHtml } from './ui.js';

function cameraErrorMessage(error) {
  if (!error) return t('camera.unavailable');
  if (['NotAllowedError', 'SecurityError', 'PermissionDeniedError'].includes(error.name)) {
    return t('camera.permissionDenied');
  }
  if (['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError'].includes(error.name)) {
    return t('camera.unavailable');
  }
  if (['NotReadableError', 'TrackStartError'].includes(error.name)) {
    return t('camera.unavailable');
  }
  return t('camera.unavailable');
}

export function openCameraModal({ onCapture }) {
  if (!window.isSecureContext && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    openModal({
      content: `
        <div class="modal-header">
          <h2 class="modal-title fs-6 fw-bold">${escapeHtml(t('camera.title'))}</h2>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="${escapeHtml(t('common.close'))}"></button>
        </div>
        <div class="modal-body"><p class="mb-0">${escapeHtml(t('camera.insecure'))}</p></div>
        <div class="modal-footer"><button class="btn btn-brand" data-bs-dismiss="modal">${escapeHtml(t('common.close'))}</button></div>`,
      dialogClass: 'modal-dialog-centered',
    });
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    toast(t('camera.unavailable'), { type: 'error' });
    return;
  }

  let stream = null;
  let facing = 'environment';
  let video = null;
  let viewport = null;
  let status = null;
  let switchButton = null;

  const stopStream = () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    if (video) video.srcObject = null;
  };

  const setStatus = (message, { spinner = false } = {}) => {
    if (!status) return;
    status.innerHTML = `
      ${spinner ? '<div class="spinner-border text-light" role="status" aria-hidden="true"></div>' : '<i class="bi bi-camera-video-off fs-2" aria-hidden="true"></i>'}
      <p class="mb-2 px-2">${escapeHtml(message)}</p>`;
    status.hidden = false;
  };

  const clearStatus = () => {
    if (status) status.hidden = true;
  };

  const applyMirror = () => {
    viewport?.classList.toggle('mirrored', facing === 'user');
  };

  const start = async () => {
    stopStream();
    setStatus(t('camera.starting'), { spinner: true });
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      if (!video) return;
      video.srcObject = stream;
      await video.play().catch(() => {});
      applyMirror();
      clearStatus();

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameras = devices.filter((device) => device.kind === 'videoinput');
        if (switchButton) switchButton.hidden = cameras.length <= 1;
      } catch {
        if (switchButton) switchButton.hidden = true;
      }
    } catch (error) {
      setStatus(cameraErrorMessage(error));
    }
  };

  const capture = () => {
    if (!video || !video.videoWidth || !video.videoHeight) {
      toast(t('camera.captureFailed'), { type: 'error' });
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (facing === 'user') {
      context.translate(canvas.width, 0);
      context.scale(-1, 1);
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          toast(t('camera.captureFailed'), { type: 'error' });
          return;
        }
        modal.hide();
        onCapture(blob);
      },
      'image/jpeg',
      0.92,
    );
  };

  const modal = openModal({
    className: 'camera-modal',
    dialogClass: 'modal-dialog-centered modal-fullscreen',
    staticBackdrop: true,
    content: `
      <div class="camera-body">
        <div class="camera-toolbar" style="padding-top: calc(16px + env(safe-area-inset-top))">
          <button type="button" class="camera-close" id="cameraClose" aria-label="${escapeHtml(t('camera.close'))}">
            <i class="bi bi-x-lg" aria-hidden="true"></i>
          </button>
          <span class="fw-semibold">${escapeHtml(t('camera.title'))}</span>
          <button type="button" class="camera-switch" id="cameraSwitch" aria-label="${escapeHtml(t('camera.switch'))}" hidden>
            <i class="bi bi-arrow-repeat" aria-hidden="true"></i>
          </button>
        </div>
        <div class="camera-viewport" id="cameraViewport">
          <video id="cameraVideo" playsinline autoplay muted></video>
          <div class="camera-frame" aria-hidden="true"></div>
          <div class="camera-status" id="cameraStatus" hidden></div>
        </div>
        <div class="camera-toolbar">
          <span style="width: 48px" aria-hidden="true"></span>
          <button type="button" class="camera-shutter" id="cameraShutter" aria-label="${escapeHtml(t('camera.capture'))}"></button>
          <span style="width: 48px" aria-hidden="true"></span>
        </div>
      </div>`,
    onShown: (element) => {
      video = element.querySelector('#cameraVideo');
      viewport = element.querySelector('#cameraViewport');
      status = element.querySelector('#cameraStatus');
      switchButton = element.querySelector('#cameraSwitch');

      element.querySelector('#cameraClose')?.addEventListener('click', () => modal.hide());
      element.querySelector('#cameraShutter')?.addEventListener('click', capture);
      switchButton?.addEventListener('click', () => {
        facing = facing === 'environment' ? 'user' : 'environment';
        applyMirror();
        start();
      });

      start();
    },
    onHidden: stopStream,
  });

  return modal;
}

export function openCropModal(dataUrl, { onApply }) {
  let cropper = null;

  const modal = openModal({
    className: 'crop-modal',
    dialogClass: 'modal-dialog-centered modal-lg',
    content: `
      <div class="modal-header">
        <h2 class="modal-title fs-6 fw-bold">${escapeHtml(t('crop.title'))}</h2>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="${escapeHtml(t('common.close'))}"></button>
      </div>
      <div class="modal-body p-0">
        <div class="crop-stage"><img id="cropImage" src="${dataUrl}" alt="${escapeHtml(t('common.image'))}" /></div>
      </div>
      <div class="modal-footer flex-wrap gap-2">
        <div class="d-flex align-items-center gap-2 me-auto">
          <button type="button" class="icon-button-sm" id="cropRotateLeft" aria-label="${escapeHtml(t('crop.rotateLeft'))}">
            <i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i>
          </button>
          <button type="button" class="icon-button-sm" id="cropRotateRight" aria-label="${escapeHtml(t('crop.rotateRight'))}">
            <i class="bi bi-arrow-clockwise" aria-hidden="true"></i>
          </button>
          <button type="button" class="btn btn-sm btn-outline-muted" id="cropReset">${escapeHtml(t('crop.reset'))}</button>
        </div>
        <button type="button" class="btn btn-outline-muted" data-bs-dismiss="modal">${escapeHtml(t('common.cancel'))}</button>
        <button type="button" class="btn btn-brand" id="cropApply">${escapeHtml(t('crop.apply'))}</button>
      </div>`,
    onShown: (element) => {
      const image = element.querySelector('#cropImage');
      if (!window.Cropper || !image) return;
      cropper = new window.Cropper(image, {
        viewMode: 1,
        autoCropArea: 0.9,
        responsive: true,
        background: false,
        zoomable: true,
        movable: true,
        checkOrientation: true,
      });

      element.querySelector('#cropRotateLeft')?.addEventListener('click', () => cropper?.rotate(-90));
      element.querySelector('#cropRotateRight')?.addEventListener('click', () => cropper?.rotate(90));
      element.querySelector('#cropReset')?.addEventListener('click', () => cropper?.reset());
      element.querySelector('#cropApply')?.addEventListener('click', () => {
        if (!cropper) {
          modal.hide();
          return;
        }
        const canvas = cropper.getCroppedCanvas({
          maxWidth: 2048,
          maxHeight: 2048,
          imageSmoothingQuality: 'high',
          fillColor: '#ffffff',
        });
        if (!canvas) {
          toast(t('scanner.imageReadError'), { type: 'error' });
          return;
        }
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              toast(t('scanner.imageReadError'), { type: 'error' });
              return;
            }
            modal.hide();
            onApply(blob);
          },
          'image/jpeg',
          0.92,
        );
      });
    },
    onHidden: () => {
      cropper?.destroy();
      cropper = null;
    },
  });

  return modal;
}
