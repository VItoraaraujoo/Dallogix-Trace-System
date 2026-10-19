export const CAMERA_OUTPUT_FPS_DEFAULT = 5;
export const CAMERA_OUTPUT_FPS_MIN = 3;
// O limite de 5 FPS mantém a captura em até 200 ms entre quadros sem elevar
// a codificação contínua além do necessário para a janela de 750 ms.
export const CAMERA_OUTPUT_FPS_MAX = 5;

export function boundedInteger(rawValue, fallback, minimum, maximum) {
  const value = Number.parseInt(rawValue || "", 10);
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

export function cameraOutputFps(rawValue) {
  return boundedInteger(
    rawValue,
    CAMERA_OUTPUT_FPS_DEFAULT,
    CAMERA_OUTPUT_FPS_MIN,
    CAMERA_OUTPUT_FPS_MAX,
  );
}
