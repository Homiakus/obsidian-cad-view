# Техническое задание: встроенный CAD-просмотрщик JT / STEP / Siemens NX PRT для Obsidian

## 1. Назначение

Разработать модуль предпросмотра 3D CAD-моделей для плагина Obsidian, позволяющий вставлять инженерные модели непосредственно в Markdown-документ и просматривать их как обычные вложения Obsidian.

Поддерживаемые исходные форматы:

- Siemens NX `.prt`;
- JT `.jt`;
- STEP `.step`;
- STEP `.stp`.

Основное пользовательское требование:

> Пользователь вставляет модель в заметку Obsidian обычной внутренней ссылкой `![[model.prt]]`, после чего плагин самостоятельно определяет формат, при необходимости запускает Siemens NX, создаёт оптимизированное представление модели и отображает интерактивную 3D-сцену непосредственно внутри документа.

Пользователь не должен вручную:

- конвертировать файлы;
- запускать Siemens NX;
- выбирать формат экспорта;
- выбирать конвертер;
- работать с временными файлами;
- обновлять предпросмотр после изменения модели;
- знать устройство внутреннего pipeline.

---

# 2. Основной пользовательский сценарий

Пользователь хранит в vault:

```text
Project/
├── README.md
├── Models/
│   ├── Housing.prt
│   ├── Assembly.prt
│   ├── Rotor.step
│   └── CompleteMachine.jt
└── Drawings/
```

В Markdown:

```markdown
## Корпус

![[Models/Housing.prt]]
```

Вместо текстовой ссылки Obsidian отображает:

```text
┌──────────────────────────────────────────────────────────┐
│ Housing.prt                                 ⟳   ⛶   ⋮    │
├──────────────────────────────────────────────────────────┤
│                                                          │
│                       3D MODEL                           │
│                                                          │
│                                                          │
├──────────────────────────────────────────────────────────┤
│ ISO   FRONT   TOP   RIGHT      Fit      Section          │
└──────────────────────────────────────────────────────────┘
```

Вращение:

- ЛКМ + drag.

Масштабирование:

- колесо мыши.

Перемещение:

- ПКМ + drag.

Двойной клик:

- выполнить `Fit`.

Клик по детали сборки:

- выделить компонент.

Контекстное меню:

- скрыть;
- изолировать;
- сделать прозрачным;
- показать свойства;
- открыть исходный файл в Siemens NX.

---

# 3. Главный принцип архитектуры

Плагин не должен содержать отдельные полноценные CAD-движки для:

```text
STEP
JT
PRT
```

Основным CAD backend должен выступать установленный Siemens NX.

Архитектура:

```text
                 Obsidian
                    │
                    ▼
             CAD Embed Handler
                    │
                    ▼
              Preview Manager
                    │
          ┌─────────┴─────────┐
          │                   │
      cache valid          cache missing
          │                   │
          ▼                   ▼
      model.glb          CAD Bridge
                              │
                              ▼
                         Siemens NX
                           NXOpen
                              │
                              ▼
                        Tessellation
                              │
                              ▼
                         model.glb
                              │
                              ▼
                        Preview Cache
                              │
                              ▼
                         Three.js
                              │
                              ▼
                      Obsidian document
```

То есть все исходные CAD-форматы в конечном итоге должны приводиться к одному внутреннему формату предпросмотра:

```text
GLB / glTF 2.0
```

---

# 4. Архитектурные компоненты

Система должна состоять из четырёх основных частей.

```text
Obsidian Plugin
│
├── Embed Controller
├── Preview Manager
├── CAD Viewer
│
└── CAD Bridge
        │
        ▼
   Siemens NX
        │
        ▼
 NXOpen Converter
```

## 4.1. Obsidian Plugin

Отвечает за:

- поиск CAD-вложений;
- отображение preview;
- состояние интерфейса;
- управление кэшем;
- запуск CAD Bridge;
- отслеживание изменения исходных файлов.

## 4.2. CAD Bridge

Отдельный локальный процесс.

Например:

```text
cad-preview-bridge.exe
```

Рекомендуемый язык:

```text
C# / .NET 8
```

Его задачи:

- обнаружить Siemens NX;
- сформировать задание конвертации;
- запустить NXOpen worker;
- контролировать процесс;
- ограничивать число NX-процессов;
- получать результат;
- возвращать структурированную ошибку.

## 4.3. NXOpen Converter

Компонент, запускаемый внутри Siemens NX.

Задачи:

```text
Open CAD
↓
Resolve assemblies
↓
Read bodies/components
↓
Tessellate
↓
Read materials/colors
↓
Read transforms
↓
Generate scene representation
↓
Export GLB
↓
Generate metadata
↓
Close NX part
```

## 4.4. CAD Viewer

WebGL-просмотрщик внутри Obsidian.

Рекомендуемый стек:

```text
Three.js
GLTFLoader
OrbitControls
```

---

# 5. Вставка модели в документ

Обязательно должна поддерживаться стандартная Obsidian-синтактика:

```markdown
![[model.prt]]
```

```markdown
![[model.step]]
```

```markdown
![[model.stp]]
```

```markdown
![[model.jt]]
```

Также:

```markdown
![[Models/Assembly.prt]]
```

Дополнительно допускается alias:

```markdown
![[Models/Assembly.prt|Редуктор]]
```

---

# 6. Параметры отображения

Должна существовать возможность задавать параметры предпросмотра.

Например:

```markdown
![[Assembly.prt|width=100%|height=500]]
```

Но основным и рекомендуемым способом должны оставаться настройки через UI.

Минимально поддерживать:

```text
height
width
camera
projection
background
edges
quality
```

При отсутствии параметров использовать глобальные настройки плагина.

---

# 7. Reading View

В режиме чтения:

```text
![[Assembly.prt]]
```

должен полностью заменяться интерактивным CAD preview.

Не должно оставаться:

```text
Assembly.prt
```

или стандартного неподдерживаемого attachment preview.

---

# 8. Live Preview

CAD preview должен работать также в режиме:

```text
Live Preview
```

Пользователь должен иметь возможность видеть модель во время редактирования заметки.

При наведении или выборе preview должны появляться управляющие элементы.

---

# 9. Source Mode

В Source Mode сохраняется обычный Markdown:

```markdown
![[Assembly.prt]]
```

Не требуется создавать полноценный 3D-рендерер внутри CodeMirror source mode.

---

# 10. Определение типа файла

Формат определяется по расширению:

```text
.prt
.step
.stp
.jt
```

Но конвертер дополнительно должен проверять:

- существование файла;
- доступность чтения;
- размер;
- возможность открытия средствами NX.

Расширение не должно считаться единственным подтверждением корректности файла.

---

# 11. Работа с Siemens NX

Плагин должен позволять указать путь к Siemens NX.

Например:

```text
C:\Program Files\Siemens\NX2512
```

При первом запуске должна выполняться автоматическая попытка обнаружения.

Порядок:

```text
Настройка пользователя
↓
NX environment
↓
стандартные каталоги Siemens
↓
Registry
```

Если NX найден автоматически:

```text
Siemens NX 2512 detected
```

---

# 12. NX должен запускаться без обычного GUI

Для автоматической конвертации предпочтительно использование NX в batch/headless-режиме.

Пользователь не должен видеть:

- окно NX;
- диалог открытия файла;
- окно экспорта;
- окно сохранения;
- промежуточные Parts.

При невозможности headless-операции допускается скрытый минимизированный NX-процесс, но это должно использоваться только как fallback.

---

# 13. Работа с открытым NX

Желательно предусмотреть два режима.

### Mode A — Batch NX

```text
Obsidian
↓
NX process
↓
convert
↓
exit
```

Преимущество:

- простая изоляция.

Недостаток:

- долгое первое открытие.

### Mode B — NX Worker

```text
Obsidian
↓
Persistent NX Worker
├── model1
├── model2
├── model3
└── ...
```

Предпочтительный режим для постоянной работы.

NX запускается один раз.

Последующие модели обрабатываются существующей NX-сессией.

---

# 14. Очередь конвертации

Нельзя запускать отдельный NX одновременно для каждого Preview.

Например, заметка содержит:

```markdown
![[A.prt]]

![[B.prt]]

![[C.prt]]

![[D.step]]
```

Нужно создать:

```text
CAD Conversion Queue

1 A.prt
2 B.prt
3 C.prt
4 D.step
```

По умолчанию:

```text
1 NX Worker
```

Все задания выполняются последовательно.

Допускается настройка:

```text
maximum workers = 1–2
```

---

# 15. Формат задания CAD Bridge

Задание должно быть сериализуемым.

Пример:

```json
{
  "jobId": "5d54c18f",
  "source": "D:/Vault/Models/Assembly.prt",
  "output": "D:/Vault/.obsidian/plugins/cad-preview/cache/xxx/model.glb",
  "quality": "normal",
  "includeAssemblyTree": true,
  "includeColors": true,
  "includeAttributes": true,
  "includePMI": false
}
```

---

# 16. Требования к конвертации PRT

Для `.prt` Siemens NX используется как основной источник геометрии.

Необходимо корректно учитывать:

- solid bodies;
- sheet bodies;
- component occurrences;
- assembly transforms;
- hidden components;
- suppressed components;
- body colors;
- component colors;
- transparency;
- units;
- reference sets;
- lightweight components;
- assembly hierarchy.

---

# 17. Сборки NX

Сборка должна сохранять структуру.

Исходная NX-структура:

```text
Assembly
├── Frame
│   ├── Left
│   └── Right
├── Motor
├── Shaft
└── Cover
```

Должна стать структурой сцены:

```text
Scene
└── Assembly
    ├── Frame
    │   ├── Left
    │   └── Right
    ├── Motor
    ├── Shaft
    └── Cover
```

Нельзя объединять всю сборку в один mesh, если это не включено специально в режиме оптимизации.

---

# 18. Трансформации компонентов

Критическое требование.

Для каждого occurrence необходимо учитывать:

```text
translation
rotation
orientation
assembly transform
parent transform
```

Конечная мировая матрица:

```text
WorldTransform =
ParentTransform
×
ComponentTransform
×
BodyTransform
```

При неправильной обработке трансформаций детали сборки не должны:

- смещаться;
- поворачиваться;
- отражаться;
- накладываться друг на друга.

---

# 19. Единицы измерения

Нужно нормализовать единицы.

Поддерживать как минимум:

```text
mm
cm
m
inch
```

Внутреннее представление рекомендуется:

```text
millimeters
```

или:

```text
meters
```

Но во всей системе должна использоваться одна конвенция.

Метаданные должны сохранять исходные units.

---

# 20. Тесселяция

NXOpen должен преобразовывать B-Rep в треугольную сетку.

Нельзя использовать фиксированную грубую точность.

Должны быть уровни:

```text
Draft
Normal
High
Ultra
```

Пример логики:

### Draft

Для огромных сборок.

```text
chord tolerance ≈ 0.5–1.0 mm
```

### Normal

Основной режим.

```text
≈ 0.1–0.25 mm
```

### High

Мелкие детали.

```text
≈ 0.02–0.1 mm
```

### Ultra

Только вручную.

---

# 21. Адаптивная тесселяция

Точность желательно зависимо выбирать от bounding box.

Условно:

```text
tolerance =
boundingBoxDiagonal × qualityFactor
```

С ограничениями min/max.

Это позволит одинаково хорошо отображать:

```text
винт M3
```

и:

```text
станок 2000 × 1000 mm
```

---

# 22. Нормали

При генерации GLB необходимо сохранять или корректно рассчитывать:

```text
vertex normals
```

Нельзя допускать:

- инвертированные нормали;
- тёмные поверхности;
- неправильный shading;
- визуальные переломы гладких поверхностей.

---

# 23. Острые грани

Для инженерных моделей должна присутствовать возможность отображения рёбер.

Режим:

```text
Shaded with Edges
```

должен быть основным.

Рёбра желательно строить отдельно от triangulation.

Допускается использование angular threshold.

Например:

```text
edgeAngle > 25°
```

---

# 24. Цвета

Необходимо максимально сохранять цвета Siemens NX.

Приоритет:

```text
Face color
↓
Body color
↓
Component color
↓
Default viewer material
```

---

# 25. Прозрачность

Если объект имеет прозрачность в NX, она должна передаваться в GLB.

Однако слишком прозрачные элементы не должны становиться фактически невидимыми.

---

# 26. Материалы

Если из NX доступна информация:

```text
Material
Steel
Aluminium
POM
etc.
```

она должна помещаться в metadata.

Физически реалистичные PBR-материалы не обязательны.

Основная задача — инженерная читаемость модели.

---

# 27. STEP

Для STEP pipeline:

```text
STEP
↓
NX importer
↓
NX Part representation
↓
same tessellation pipeline
↓
GLB
```

То есть после открытия STEP дальнейшая обработка должна быть такой же, как PRT.

---

# 28. JT

Для JT:

```text
JT
↓
NX JT loader
↓
faceted / precise representation
↓
normalized scene
↓
GLB
```

Если JT содержит только faceted geometry, следует использовать её напрямую, не пытаться восстанавливать B-Rep.

---

# 29. Унифицированная внутренняя модель

Перед экспортом в GLB желательно использовать единое внутреннее представление:

```text
CadScene
├── nodes[]
├── meshes[]
├── materials[]
├── metadata
└── bounds
```

Пример:

```text
CadNode
{
    id
    name
    nxId
    parentId
    transform
    visible
    children[]
    meshes[]
}
```

---

# 30. GLB

Основной формат кэша:

```text
.glb
```

Преимущества:

- один файл;
- бинарный;
- быстро загружается;
- поддерживается Three.js;
- поддерживает hierarchy;
- материалы;
- transforms;
- metadata.

---

# 31. GLB optimization

Должны поддерживаться:

- indexed geometry;
- объединение одинаковых материалов;
- удаление duplicate vertices;
- normal compression;
- mesh compression опционально.

Но оптимизация не должна уничтожать структуру компонентов.

---

# 32. CAD metadata

Рядом с GLB хранить:

```text
metadata.json
```

Например:

```json
{
  "source": "Assembly.prt",
  "format": "prt",
  "units": "mm",
  "generatedAt": "2026-08-13T18:23:20Z",
  "sourceMtime": 1786643233,
  "sourceSize": 19238122,
  "converterVersion": 3,
  "nxVersion": "2512.6000",
  "componentCount": 184,
  "bodyCount": 216,
  "triangleCount": 1843200
}
```

---

# 33. Кэш

Кэш является обязательной частью архитектуры.

Структура:

```text
.obsidian/
└── plugins/
    └── cad-preview/
        └── cache/
            ├── a812b9/
            │   ├── model.glb
            │   └── metadata.json
            └── ...
```

---

# 34. Cache key

Не следует использовать только имя файла.

Рекомендуется:

```text
SHA256(
    normalizedAbsolutePath
    +
    fileSize
    +
    modificationTime
    +
    converterVersion
    +
    qualitySettings
)
```

---

# 35. Проверка актуальности

Перед отображением:

```text
find cache
↓
compare source mtime
↓
compare size
↓
compare converter version
↓
compare render settings
```

Если всё совпадает:

```text
load GLB
```

Если нет:

```text
queue conversion
```

---

# 36. Автоматическое обновление

Если пользователь сохраняет файл:

```text
Housing.prt
```

в NX, Obsidian должен обнаружить изменение.

Последовательность:

```text
file changed
↓
invalidate cache
↓
mark preview outdated
↓
delay/debounce
↓
generate new preview
↓
swap GLB
```

Необходимо использовать debounce.

Например:

```text
1–3 seconds
```

чтобы NX не запускался несколько раз при серии изменений.

---

# 37. UI во время конвертации

Нельзя показывать пустой блок.

Пример:

```text
┌───────────────────────────────────┐
│ Assembly.prt                      │
│                                   │
│ Создание предпросмотра...         │
│ Siemens NX                        │
│ ███████████░░░░                   │
│                                   │
│ В очереди: 2                      │
└───────────────────────────────────┘
```

---

# 38. Состояния Preview

Необходимо явно моделировать состояния:

```text
Idle
Queued
OpeningNX
LoadingCAD
Tessellating
Exporting
Optimizing
Ready
Stale
Error
```

---

# 39. Основной Viewer

Viewer должен содержать:

```text
Scene
Camera
Renderer
Controls
Lighting
SelectionManager
ClippingManager
MeasurementManager
ModelTree
```

---

# 40. Камера

Поддерживать:

```text
Perspective
Orthographic
```

Для инженерной работы основной режим желательно:

```text
Orthographic
```

или configurable.

---

# 41. Стандартные виды

Обязательные кнопки:

```text
ISO
Front
Back
Top
Bottom
Left
Right
```

---

# 42. Fit

`Fit` должен рассчитываться по bounding box модели.

После загрузки модели:

```text
Fit automatically
```

---

# 43. Освещение

Инженерная модель должна быть хорошо читаема без настройки пользователем.

Использовать:

```text
ambient/environment light
+
directional lights
```

Не следует создавать драматическое художественное освещение.

---

# 44. Background

Поддерживать:

```text
Follow Obsidian theme
Light
Dark
Custom
Transparent
```

По умолчанию:

```text
Follow Obsidian theme
```

---

# 45. Выделение компонентов

Клик по mesh:

```text
raycast
↓
resolve component
↓
highlight
```

Необходимо выделять логический компонент, а не только отдельный triangle.

---

# 46. Hover

Опционально:

```text
hover highlight
```

Но для больших моделей его можно отключать ради производительности.

---

# 47. Дерево сборки

Для assemblies необходимо отображать дерево.

Например:

```text
▼ Assembly
  ▼ Frame
    ○ Left plate
    ○ Right plate
  ○ Motor
  ○ Shaft
  ○ Bearing 1
  ○ Bearing 2
```

---

# 48. Синхронизация дерева и 3D

Клик по дереву:

```text
select in 3D
```

Клик по модели:

```text
select in tree
```

---

# 49. Visibility

Для каждого компонента:

```text
Show
Hide
```

---

# 50. Isolate

Команда:

```text
Isolate
```

должна скрывать все остальные компоненты.

---

# 51. Transparency

Команда:

```text
Transparent
```

например:

```text
opacity = 0.2
```

---

# 52. Ghost mode

Полезный режим:

```text
selected object = normal
others = transparent
```

---

# 53. Section Plane

Поддерживать минимум одну плоскость сечения:

```text
X
Y
Z
Custom
```

Манипулятор должен позволять перемещать плоскость.

---

# 54. Измерение

Минимально:

```text
Point → Point distance
```

Далее:

```text
edge length
radius
diameter
angle
```

Важно явно указывать units:

```text
34.52 mm
```

---

# 55. Coordinate axes

Опционально показывать:

```text
X
Y
Z
```

в углу viewer.

---

# 56. Bounding box

Должна быть команда:

```text
Model information
```

с:

```text
X = 248.2 mm
Y = 152.0 mm
Z = 98.4 mm
```

---

# 57. Properties

Для выбранного объекта:

```text
Name
NX Part
Component
Layer
Material
Color
Mass
Attributes
```

если информация доступна.

---

# 58. Открытие в Siemens NX

В toolbar:

```text
Open in NX
```

Команда должна открывать именно исходный:

```text
*.prt
*.step
*.jt
```

а не GLB.

---

# 59. Reveal in Explorer

Добавить:

```text
Show in Explorer
```

---

# 60. Rebuild preview

Добавить:

```text
Regenerate preview
```

Команда:

```text
invalidate cache
↓
queue conversion
```

---

# 61. Размер preview

Preview должен быть responsive.

По умолчанию:

```text
width: 100%
height: 400–500 px
```

Минимум:

```text
200 px
```

---

# 62. Fullscreen

Обязательная кнопка:

```text
Fullscreen
```

Она должна раскрывать viewer поверх интерфейса Obsidian.

---

# 63. Отдельная вкладка

Двойной клик по заголовку модели или команда:

```text
Open CAD Preview
```

должны открывать модель в отдельной вкладке Obsidian.

---

# 64. Lazy loading

Если заметка содержит 20 моделей, нельзя сразу запускать 20 WebGL сцен.

Использовать:

```text
IntersectionObserver
```

Модель загружается, когда preview приближается к viewport.

---

# 65. Освобождение ресурсов

При уничтожении preview необходимо:

```text
dispose geometry
dispose materials
dispose textures
dispose renderer
remove listeners
cancel animation loop
```

Иначе Obsidian будет постепенно расходовать GPU/RAM.

---

# 66. Один render loop

Не следует создавать тяжёлый бесконечный rendering loop для каждого preview.

Использовать:

```text
render on demand
```

Перерисовывать при:

- движении камеры;
- изменении visibility;
- selection;
- resize;
- animation.

---

# 67. Большие модели

Необходимо предусмотреть модели:

```text
100 MB
500 MB
1 GB+
```

и сборки:

```text
100
1000
10000 components
```

Viewer не обязан гарантировать идеальную работу с любой сборкой, но должен деградировать управляемо.

---

# 68. Автоматическое снижение качества

Если:

```text
triangleCount > threshold
```

предлагать или автоматически включать:

```text
Draft quality
```

Например:

```text
< 2M triangles → normal

2–10M → optimized

> 10M → warning / simplified
```

Порог должен настраиваться.

---

# 69. Защита от гигантской геометрии

Перед загрузкой GLB проверять metadata.

Если файл потенциально опасен для WebGL:

```text
Модель слишком большая.

Triangles: 38.4M

[Открыть всё равно]
[Перегенерировать в Draft]
```

---

# 70. Настройки

Настройки должны быть простыми.

Основной экран:

```text
CAD Preview

Siemens NX
[ C:\Program Files\Siemens\NX2512 ]

Preview quality
[ Normal ]

Default view
[ Isometric ]

Projection
[ Orthographic ]

Show edges
[x]

Auto update
[x]

Cache
2.4 GB
[Clear cache]

Advanced >
```

---

# 71. Advanced Settings

Скрыть технические параметры в отдельный раздел:

```text
Tessellation tolerance
Angular tolerance
NX timeout
Worker mode
Maximum triangle count
GLB compression
Logging level
Cache directory
```

Обычному пользователю эти параметры не нужны.

---

# 72. Проверка NX

Настройки должны иметь кнопку:

```text
Test Siemens NX
```

Результат:

```text
✓ Siemens NX detected
Version: NX 2512.6000
NXOpen: available
JT: available
STEP: available
Batch execution: available
```

---

# 73. Диагностика

Команда:

```text
CAD Preview: Diagnostics
```

должна показывать:

```text
Plugin version
Bridge version
NX version
NX path
Cache path
Worker state
Queue size
Last conversion
Last error
```

---

# 74. Логирование

Использовать структурированные логи.

Например:

```text
2026-08-13 20:14:02
job=51eabc
stage=tessellation
part=Housing.prt
bodies=12
triangles=283102
duration=1.74s
```

---

# 75. Ошибки

Пользователь не должен видеть:

```text
System.NullReferenceException...
```

или stack trace.

UI:

```text
Не удалось создать предпросмотр Assembly.prt.

Причина:
Siemens NX не смог открыть файл.

[Повторить]
[Открыть в NX]
[Подробнее]
```

---

# 76. Error codes

Внутренне использовать коды:

```text
NX_NOT_FOUND
NX_START_FAILED
NX_TIMEOUT
FILE_NOT_FOUND
FILE_LOCKED
CAD_OPEN_FAILED
STEP_IMPORT_FAILED
JT_IMPORT_FAILED
TESSELLATION_FAILED
GLB_EXPORT_FAILED
CACHE_WRITE_FAILED
VIEWER_LOAD_FAILED
```

---

# 77. Таймаут

NX-задача не должна зависнуть навсегда.

Например:

```text
default timeout = 120 seconds
```

Для больших моделей:

```text
configurable
```

---

# 78. Cancel

Пользователь должен иметь возможность:

```text
Cancel conversion
```

Если задача ещё находится в очереди — удалить её.

Если выполняется — безопасно отменить job.

---

# 79. Crash recovery

Если NX worker завершился аварийно:

```text
detect process exit
↓
mark current job failed
↓
restart worker
↓
continue queue
```

---

# 80. Безопасность исходных файлов

Конвертер не имеет права изменять исходную CAD-модель.

Открытие должно выполняться:

```text
read-only
```

где это возможно.

Нельзя:

- Save;
- Save As поверх оригинала;
- менять attributes;
- изменять geometry;
- обновлять assembly;
- выполнять массовое сохранение.

---

# 81. Временные файлы

Все временные данные хранить отдельно:

```text
%TEMP%\ObsidianCadPreview\
```

или:

```text
plugin cache
```

После успешной операции временные файлы удалять.

---

# 82. Vault не должен засоряться

Не создавать рядом с исходным:

```text
Housing.glb
Housing.stl
Housing_preview.json
```

По умолчанию всё должно находиться в plugin cache.

---

# 83. Архитектура исходного кода

Не плодить десятки микрофайлов.

Рекомендуемая структура:

```text
src/
├── main.ts
│
├── cad/
│   ├── preview-manager.ts
│   ├── cad-view.ts
│   ├── renderer.ts
│   ├── bridge.ts
│   └── model-tree.ts
│
└── settings.ts

bridge/
├── CadPreviewBridge/
│
└── NxCadConverter/
```

Не делать отдельный слой/класс для каждой мелкой операции без необходимости.

---

# 84. Interfaces

Основной интерфейс:

```typescript
interface CadPreviewProvider {
    supports(path: string): boolean;

    getPreview(
        source: string,
        options: PreviewOptions
    ): Promise<PreviewResult>;
}
```

---

# 85. PreviewResult

```typescript
interface PreviewResult {
    glbPath: string;
    metadataPath: string;
    fromCache: boolean;
}
```

---

# 86. Viewer API

```typescript
interface CadViewer {
    load(model: PreviewResult): Promise<void>;

    fit(): void;

    setView(view: StandardView): void;

    select(id: string): void;

    isolate(id: string): void;

    hide(id: string): void;

    show(id: string): void;

    dispose(): void;
}
```

---

# 87. Renderer не должен знать о NX

Очень важная граница:

```text
Viewer
```

не знает:

```text
PRT
STEP
JT
NXOpen
Siemens NX
```

Viewer знает только:

```text
GLB
metadata
```

---

# 88. NX Converter не должен знать об Obsidian

NX-часть не должна зависеть от:

```text
Obsidian
Markdown
Three.js
DOM
```

Это отдельный CAD conversion engine.

---

# 89. Возможность использования вне Obsidian

Архитектура должна позволять впоследствии использовать:

```text
cad-preview-bridge.exe input.prt output.glb
```

из CLI.

Это сильно облегчит тестирование.

---

# 90. CLI

Рекомендуемый интерфейс:

```bash
cad-preview convert Assembly.prt --output Assembly.glb
```

или:

```bash
cad-preview inspect Assembly.prt
```

---

# 91. Автоматические тесты конвертера

Создать эталонный набор:

```text
tests/models/

cube.prt
cylinder.prt
sheet.prt
colored.prt
assembly-simple.prt
assembly-nested.prt
assembly-transformed.prt
part.step
assembly.step
sample.jt
```

---

# 92. Геометрические тесты

Для каждой модели проверять:

```text
body count
component count
bounding box
triangle count > 0
normal count
material count
```

---

# 93. Тест трансформации сборки

Создать сборку:

```text
Cube A
Cube B translated X +100
Cube C rotated Z +90°
```

После конвертации проверить положения программно.

Это обязательный regression test.

---

# 94. Units test

Создать одинаковую модель:

```text
100 mm cube
```

в:

```text
millimeter part
inch part
```

Обе модели должны отображаться одинакового физического размера.

---

# 95. Color test

Модель:

```text
body A red
body B blue
body C transparent
```

После GLB:

```text
colors preserved
```

---

# 96. Nested assembly test

Проверить:

```text
assembly
└── subassembly
    └── subassembly
        └── part
```

Трансформации должны накапливаться корректно.

---

# 97. Cache test

Сценарий:

```text
open model
→ conversion occurs

open again
→ no NX invocation

modify source
→ conversion occurs
```

---

# 98. Crash test

Искусственно завершить NX Worker.

Проверить:

```text
Obsidian survives
queue survives
worker restarts
```

---

# 99. Viewer tests

Проверять:

```text
load
fit
selection
isolate
hide/show
section
dispose
resize
theme change
```

---

# 100. Memory leak test

Автоматически:

```text
open/close model × 100
```

GPU/RAM не должны расти линейно.

---

# 101. Performance target

Для уже закэшированной обычной модели:

```text
Preview visible < 1 second
```

желательно:

```text
< 300–500 ms
```

после чтения GLB с SSD.

---

# 102. First conversion

Время первой конвертации зависит от NX и модели, поэтому жёсткий лимит задавать нельзя.

Однако UI должен начать показывать состояние:

```text
< 200 ms
```

после обнаружения embed.

---

# 103. CAD Preview Quality

Основным критерием качества является визуальное соответствие NX.

Проверять:

```text
NX screenshot
↕
Obsidian screenshot
```

По:

- положению компонентов;
- форме;
- ориентации;
- цветам;
- пропорциям;
- видимости;
- прозрачности.

---

# 104. Definition of Correct Conversion

Конвертация считается корректной, если:

1. отсутствуют пропущенные видимые тела;
2. нет лишних тел;
3. компоненты находятся на правильных позициях;
4. единицы соблюдены;
5. orientation совпадает;
6. topology визуально соответствует оригиналу;
7. отсутствуют большие tessellation artifacts;
8. нормали правильные;
9. цвета сохранены;
10. структура assembly сохранена.

---

# 105. Пример полного workflow

Пользователь пишет:

```markdown
# Узел дозирования

## Сборка

![[CAD/DosingUnit.prt]]
```

Obsidian обнаруживает:

```text
.prt
```

Проверяет cache:

```text
not found
```

Создаёт job:

```text
job 412
```

CAD Bridge:

```text
open NX worker
↓
load DosingUnit.prt
↓
resolve assembly
↓
tessellate 42 bodies
↓
create hierarchy
↓
write GLB
↓
write metadata
```

Obsidian:

```text
load GLB
↓
fit camera
↓
render
```

Следующее открытие:

```text
read GLB directly
```

Siemens NX больше не запускается.

---

# 106. UX-принцип

Для пользователя система должна выглядеть максимально просто:

```text
![[model.prt]]
```

Всё.

Не должно существовать обязательного workflow:

```text
ПКМ
→ Generate Preview
→ выбрать формат
→ выбрать качество
→ выбрать export
→ открыть viewer
```

Все эти операции должны выполняться автоматически.

---

# 107. Прогрессивное раскрытие сложности

Интерфейс должен иметь три уровня.

## Level 1

Обычный пользователь видит:

```text
Model
Fit
Views
Fullscreen
```

## Level 2

Меню:

```text
Assembly
Section
Measure
Display
```

## Level 3

Advanced:

```text
Tessellation
Cache
NX
Diagnostics
```

---

# 108. Не делать mini-NX

Viewer предназначен для:

```text
просмотра
понимания
проверки
навигации
измерения
```

Но не для:

```text
моделирования
редактирования sketch
feature editing
CAM
assemblies editing
```

Для этого существует кнопка:

```text
Open in Siemens NX
```

---

# 109. Минимальная версия MVP

Первая полностью рабочая версия должна поддерживать:

- `![[*.prt]]`;
- `![[*.step]]`;
- `![[*.stp]]`;
- `![[*.jt]]`;
- NX backend;
- автоматическую конвертацию;
- GLB;
- кэш;
- Three.js;
- rotate;
- zoom;
- pan;
- Fit;
- ISO;
- Front;
- Top;
- Right;
- shaded;
- shaded + edges;
- тёмную/светлую тему;
- автоматическое обновление;
- кнопку `Open in NX`;
- нормальное отображение ошибок.

---

# 110. Вторая версия

Добавить:

- hierarchy сборки;
- selection;
- hide/show;
- isolate;
- transparency;
- properties;
- component colors.

---

# 111. Третья версия

Добавить:

- section planes;
- measurement;
- advanced metadata;
- large assembly optimization;
- persistent NX worker;
- background preprocessing.

---

# 112. Четвёртая версия

При необходимости:

- PMI;
- annotations;
- NX attributes;
- mass properties;
- material properties;
- exploded representation;
- named views.

---

# 113. Итоговая целевая архитектура

```text
                    OBSIDIAN
                       │
                       │ ![[model.prt]]
                       ▼
                Embed Controller
                       │
                       ▼
                Preview Manager
                       │
             ┌─────────┴─────────┐
             │                   │
        VALID CACHE           NO CACHE
             │                   │
             │                   ▼
             │               Job Queue
             │                   │
             │                   ▼
             │              CAD Bridge
             │                   │
             │                   ▼
             │              Siemens NX
             │                   │
             │                  NXOpen
             │                   │
             │                   ▼
             │             CAD Scene Builder
             │                   │
             │                   ▼
             │              Tessellation
             │                   │
             │                   ▼
             │               GLB Export
             │                   │
             └───────────┬───────┘
                         │
                         ▼
                    GLB Cache
                         │
                         ▼
                     Three.js
                         │
                         ▼
               Interactive Preview
```

---

# 114. Ключевой критерий готовности

Функциональность считается готовой, если инженер может взять существующий vault, положить рядом реальную модель Siemens NX:

```text
Assembly.prt
```

написать:

```markdown
![[Assembly.prt]]
```

и без каких-либо дополнительных действий получить внутри Obsidian правильное интерактивное изображение той же сборки, которое:

- геометрически соответствует Siemens NX;
- имеет правильное положение всех деталей;
- сохраняет цвета;
- сохраняет структуру сборки;
- быстро открывается повторно;
- автоматически обновляется после изменения PRT;
- не изменяет исходный CAD-файл;
- не требует ручной конвертации;
- не засоряет vault вспомогательными файлами;
- при необходимости одним действием открывает исходную модель в Siemens NX.

Именно этот сценарий должен определять архитектуру, API, интерфейс и приоритет разработки всего модуля.