# Calculadora de Horas Anuales CGT

Herramienta de CGT Primark Gran Vía (Madrid). La misma página incluye el registro manual, el lector de rotas, los resultados y los informes.

## Uso desde el móvil

1. Abre la calculadora en Chrome o en tu navegador habitual. Selecciona la jornada semanal y la distribución de días de tu contrato.
2. En **Mis horas**, el lector de rotas PDF está seleccionado por defecto. También puedes elegir **Introducir horas manualmente**. En modo manual, introduce el total o añade registros semanales o mensuales. Introduce las horas trabajadas en decimal, por ejemplo `37,5`.
3. Para leer rotas, selecciona los PDF e introduce el nombre tal como aparece en ellos. Revisa el año, los avisos de cobertura, la versión correcta si hay conflictos y los descansos. Abre una semana para revisar sus turnos. Pulsa **Calcular mis horas** para obtener el resultado automáticamente.
4. Indica cuántas horas complementarias hiciste y qué parte ya figuraba en el total anterior. Anota por separado la distribución irregular aplicada.
5. Consulta **Mis resultados** y **Informe**. Puedes copiar el resumen, descargar el CSV o el PDF, e imprimir. Al terminar, **Borrar todos los datos** limpia el formulario, las rotas y los resultados de la pestaña.

## Criterios de cálculo

- Se usan minutos enteros. La referencia proporcional redondea al minuto tras aplicar la regla de tres por días naturales inclusivos. Para 158 días y 1.120 horas anuales, la aplicación muestra 484,82 h.
- La tabla de once opciones reproduce la última referencia facilitada por CGT. El [art. 20 modificado del convenio](https://www.boe.es/diario_boe/txt.php?id=BOE-A-2025-26529) fija 1.765 h de jornada máxima anual efectiva para 2026. La tabla usa la etiqueta de 39,4 h. La denominación habitual de 40 h no añade otra fila de referencia.
- Conviene cotejar con la tabla original y el calendario del centro las 880 h de la fila de 16 h, que superan las 806 h de la fila de 18 h. La columna irregular reproduce las horas de referencia, con sus redondeos. La app no infiere correcciones de las cifras facilitadas ni extrapola la referencia a otros años.
- Las rotas indican horas planificadas. Se registra la presencia y se descuentan 0,5 h si el contrato supera las 30 h semanales y el turno dura más de 6 h. El descanso puede corregirse por turno. Un turno nocturno queda asociado a la fecha de inicio que figura en la rota.
- Las marcas V inequívocas se cuentan aparte. Los 31 días naturales corresponden a un año completo según el [art. 22 del convenio](https://www.boe.es/diario_boe/txt.php?id=BOE-A-2021-14561). Las marcas visibles no acreditan el cómputo completo de vacaciones. La diferencia con la referencia es orientativa y no acredita una deuda.
- Las complementarias ya incluidas se descuentan del total registrado para estimar ordinarias y se integran una sola vez en el total con complementarias. Las irregulares se muestran por separado como distribución de las ordinarias.
- El período PDF abarca las fechas reales de las semanas seleccionadas, recortadas al año elegido. Una rota contradictoria necesita selección explícita. Los huecos y avisos de lectura suspenden la diferencia provisional. Una selección parcial no se presenta como jornada anual completa.

## Privacidad y compatibilidad

PDF.js 4.10.38 y su worker se sirven desde `vendor/`. El lector entrega bytes, nunca una URL, a PDF.js. La página bloquea conexiones de scripts mediante su política de contenido y no tiene formularios de envío, telemetría, almacenamiento persistente ni backend. Los PDF se procesan en secuencia y se liberan al terminar cada archivo. Los informes incluyen la información de la fila seleccionada, omiten nombres y nombres de archivo. No añadas rotas reales a GitHub ni a las pruebas.

La extracción usa las posiciones del formato de rota existente. Si no se reconoce la fecha, la identidad o el turno, se muestra un aviso. Los PDF escaneados sin texto requieren otro formato de origen. La coincidencia de nombre exige todas las palabras exactas, con independencia de acentos y orden. El lector no puede distinguir dos personas con el mismo nombre que figuren en documentos distintos.

## Desarrollo y comprobaciones

- `index.html` y `css/styles.css`: página y estilos.
- `js/calculator.mjs`: contratos, fechas y cómputo en minutos.
- `js/pdf-reader.mjs` y `js/rota-parser.mjs`: PDF.js, extracción, cobertura y versiones.
- `js/app.mjs` y `js/reports.mjs`: interfaz y exportaciones.
- `lector-rotas.html`: enlace antiguo que redirige al lector integrado.

Sirve el directorio por HTTP durante el desarrollo. GitHub Pages puede servir la raíz directamente, sin paso de compilación.

```sh
node --test tests/calculator.test.mjs
npm install --no-save --no-package-lock playwright
npx playwright install chromium
node tests/browser.mjs
```

Puedes indicar un Chromium instalado mediante `CGT_CHROMIUM`. La prueba del navegador usa la ruta de GitHub Pages, un perfil móvil y PDF sintéticos generados en memoria. Verifica lectura, cobertura, deduplicación, elección de versiones, descansos, complementarias, descargas y solicitudes de red. No sustituye la revisión con los formatos reales de rota en el móvil que se vaya a usar.
