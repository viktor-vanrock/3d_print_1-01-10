# Дайджест на ревью человеку — 15:00 пт 04.09.2026

Всё ниже — не ошибки конвейера, а места, где источники расходятся или
правило не может решить само. Ничего из этого не переносилось в `data/`.

## 1. Вендор в меньшинстве (14)

Два независимых магазина сошлись между собой и разошлись с вендором. Это
список на разбор, не замена: у H2D магазины дают 1000 мм/с против 600 у
вендора — и правы не они (потолок прошивки).

| Станок | Поле | Магазины | Вендор | Кто | Цитата магазина |
|---|---|---|---|---|---|
| anycubic.kobra-2 | max_speed_mms | 250 | 300 | 3D-DIY, 3DToday, Cvetmir3D | «Высокая скорость печати | 250 мм/с на максимальной скорости» |
| anycubic.kobra-2-max | weight_kg | 21 | 17.6 | 3D-DIY, 3DToday, Cvetmir3D | «Вес (без упаковки) | 21 кг» |
| anycubic.kobra-2-neo | enclosed | false | true | 3D-DIY, 3DVision | «Тип корпуса Открытый» |
| anycubic.kobra-2-neo | max_nozzle_temp_c | 260 | 320 | 3D-DIY, 3DToday, 3DVision | «Максимальная температура экструдера, °С 260» |
| anycubic.kobra-2-neo | max_speed_mms | 250 | 600 | 3D-DIY, 3DToday, 3DVision, Cvetmir3D | «Скорость печати | 250 мм/с (макс.), 150 мм/с (реком.)» |
| anycubic.kobra-s1 | noise_db | 46 | 44 | 3DToday, 3DVision | «уровень звукового давления составляет всего 46 дБ в стандартном режиме» |
| bambulab.h2d | max_speed_mms | 1000 | 600 | 3D-DIY, 3DVision, Cvetmir3D | «Скорость печати | 1000 мм/с (макс.)» |
| creality.ender-5 | max_nozzle_temp_c | 260 | 300 | 3D-DIY, Cvetmir3D | «Рабочая температура экструдера | до 260 ℃» |
| flashforge.adventurer-5m | build_volume | {"x": 220, "y": 200, "z": 220, | {"x": 220, "y": 220, "z": 220, | 3D-DIY, 3DToday | «Область печати, XYZ 220x200x220 мм» |
| flashforge.adventurer-5m | max_bed_temp_c | 110 | 100 | 3D-DIY, 3DToday, Cvetmir3D | «Температура подогрева площадки | 110℃» |
| flashforge.adventurer-5m-pro | max_bed_temp_c | 110 | 100 | 3D-DIY, Cvetmir3D | «Температура подогрева площадки | 110℃» |
| flashforge.adventurer-5m-pro | noise_db | 50 | 55 | 3DVision, Cvetmir3D | «Шум при работе | 50 Дб» |
| flsun.v400 | max_speed_mms | 400 | 1000 | 3D-DIY, 3DVision | «Максимальная скорость печати, мм/с 400» |
| qidi.x-max | build_volume | {"x": 300, "y": 250, "z": 300, | {"x": 325, "y": 325, "z": 315, | 3D-DIY, 3DToday | «Область печати, XYZ 300x250x300 мм» |

## 2. Споры магазин/вендор — все (176)

По полям: {'build_volume': 47, 'max_speed_mms': 33, 'connectivity': 23, 'weight_kg': 18, 'max_nozzle_temp_c': 9, 'dimensions_mm': 6, 'max_bed_temp_c': 6, 'noise_db': 5, 'materials_supported': 5, 'nozzle_hardened': 5}

| Станок | Поле | Магазин → значение | Известно (источник) | Цитата магазина |
|---|---|---|---|---|
| anet.a2 | build_volume | 3DToday → {"x": 210, "y": 210, "z": 19 | {"shape": "rectangular", "x" (cura) | «Область построения, мм: 210x210x195» |
| anycubic.4max-pro | connectivity | 3DToday → ["USB", "Card Reader"] | ["SD Card", "USB Port"] (anycubic) | «Интерфейсы | USB, Card Reader» |
| anycubic.4max-pro | weight_kg | 3D-DIY → 22 | 18.5 (anycubic) | «Вес нетто (кг) 22» |
| anycubic.chiron | connectivity | 3D-DIY → ["USB (Кабель)", "SD Card",  | ["Memory card", "Data cable" (anycubic) | «Способ отправки файлов на печать USB (Кабель), SD Card» |
| anycubic.chiron | connectivity | 3DToday → ["USB", "Card Reader"] | ["Memory card", "Data cable" (anycubic) | «Интерфейсы | USB, Card Reader» |
| anycubic.kobra | max_speed_mms | 3D-DIY → 400 | 180 (anycubic) | «Максимальная скорость печати, мм/с 400» |
| anycubic.kobra | weight_kg | 3D-DIY → 6 | 7 (anycubic) | «Вес нетто (кг) 6» |
| anycubic.kobra-2 | connectivity | 3DToday → ["Card Reader"] | ["MicroSD Card"] (anycubic) | «Интерфейсы | Card Reader» |
| anycubic.kobra-2 | connectivity | 3DVision → ["MicroSD"] | ["MicroSD Card"] (anycubic) | «Интерфейсы | MicroSD» |
| anycubic.kobra-2 | max_accel_mms2 | 3DVision → 2500 | 3000 (anycubic) | «ускорение до 2500 мм/с2» |
| anycubic.kobra-2 | max_speed_mms | 3D-DIY → 250 | 300 (anycubic) | «Максимальная скорость печати, мм/с 250» |
| anycubic.kobra-2 | max_speed_mms | 3DToday → 250 | 300 (anycubic) | «Максимальная скорость печати | 250 мм/с» |
| anycubic.kobra-2 | max_speed_mms | Cvetmir3D → 250 | 300 (anycubic) | «Высокая скорость печати | 250 мм/с на максимальной скорости» |
| anycubic.kobra-2-max | power_loss_recovery | 3D-DIY → true | false (anycubic) | «Система возобновления печати при потере питания Да» |
| anycubic.kobra-2-max | weight_kg | 3D-DIY → 21 | 17.6 (anycubic) | «Вес нетто (кг) 21» |
| anycubic.kobra-2-max | weight_kg | 3DToday → 21 | 17.6 (anycubic) | «Вес, кг | 21 (нетто)» |
| anycubic.kobra-2-max | weight_kg | Cvetmir3D → 21 | 17.6 (anycubic) | «Вес (без упаковки) | 21 кг» |
| anycubic.kobra-2-neo | camera | 3D-DIY → false | true (anycubic) | «Видеокамера Нет» |
| anycubic.kobra-2-neo | connectivity | 3DToday → ["MicroSD"] | ["wifi"] (anycubic) | «Интерфейс | MicroSD» |
| anycubic.kobra-2-neo | connectivity | 3DVision → ["MicroSD", "USB Type-C"] | ["wifi"] (anycubic) | «Интерфейсы | TF (MicroSD) / USB Type-C» |
| anycubic.kobra-2-neo | connectivity | Cvetmir3D → ["MicroSD", "Type-C"] | ["wifi"] (anycubic) | «Интерфейс подключения | MicroSD , Type-C» |
| anycubic.kobra-2-neo | enclosed | 3D-DIY → false | true (anycubic) | «Тип корпуса Открытый» |
| anycubic.kobra-2-neo | enclosed | 3DVision → false | true (anycubic) | «Конструкция корпуса | Открытая» |
| anycubic.kobra-2-neo | filament_runout_sensor | 3DToday → "опциональный" | true (anycubic) | «Датчик филамента | опциональный» |
| anycubic.kobra-2-neo | max_nozzle_temp_c | 3D-DIY → 260 | 320 (anycubic) | «Максимальная температура экструдера, °С 260» |
| anycubic.kobra-2-neo | max_nozzle_temp_c | 3DToday → 260 | 320 (anycubic) | «Максимальная температура хотэнда | 260℃» |
| anycubic.kobra-2-neo | max_nozzle_temp_c | 3DVision → 260 | 320 (anycubic) | «Температура экструдера, °C | до 260°C» |
| anycubic.kobra-2-neo | max_speed_mms | 3D-DIY → 250 | 600 (anycubic) | «Максимальная скорость печати, мм/с 250» |
| anycubic.kobra-2-neo | max_speed_mms | 3DToday → 250 | 600 (anycubic) | «Максимальная скорость печати | 250 мм/с» |
| anycubic.kobra-2-neo | max_speed_mms | 3DVision → 250 | 600 (anycubic) | «Скорость печати | до 250 мм/с» |
| anycubic.kobra-2-neo | max_speed_mms | Cvetmir3D → 250 | 600 (anycubic) | «Скорость печати | 250 мм/с (макс.), 150 мм/с (реком.)» |
| anycubic.kobra-3-max | nozzle_hardened | 3D-DIY → true | false (orcaslicer) | «Керамическая трубка подачи пластика изготовлена из материала» |
| anycubic.kobra-3-max | weight_kg | 3D-DIY → 22.5 | 19 (anycubic) | «Вес нетто (кг) 22.5» |
| anycubic.kobra-max | max_speed_mms | 3D-DIY → 100 | 180 (anycubic) | «Максимальная скорость печати, мм/с 100» |
| anycubic.kobra-max | weight_kg | 3D-DIY → 20 | 16 (anycubic) | «Вес нетто (кг) 20» |
| anycubic.kobra-neo | connectivity | Cvetmir3D → ["SD-карта"] | ["SD Card"] (anycubic) | «SD-карта» |
| anycubic.kobra-neo | weight_kg | 3D-DIY → 6 | 7.4 (anycubic) | «Вес нетто (кг) 6» |
| anycubic.kobra-plus | connectivity | 3DVision → ["Micro SD"] | ["MicroSD Card"] (anycubic) | «Слот для карты памяти: карта Micro SD» |
| anycubic.kobra-plus | connectivity | Cvetmir3D → ["SD Card"] | ["MicroSD Card"] (anycubic) | «SD Card» |
| anycubic.kobra-plus | dimensions_mm | 3D-DIY → {"w": 500, "d": 500, "h": 55 | {"w": 560, "d": 546, "h": 60 (anycubic) | «Габариты товара ДxШxВ (см) 50х50х55» |
| anycubic.kobra-plus | max_bed_temp_c | 3D-DIY → 110 | 100 (anycubic) | «Максимальная температура платформы, °С 110» |
| anycubic.kobra-plus | max_speed_mms | 3D-DIY → 250 | 180 (anycubic) | «Максимальная скорость печати, мм/с 250» |
| anycubic.kobra-plus | max_speed_mms | 3DToday → 100 | 180 (anycubic) | «Скорость печати | до 100 мм/с» |
| anycubic.kobra-plus | weight_kg | 3D-DIY → 15 | 11 (anycubic) | «Вес нетто (кг) 15» |
| anycubic.kobra-plus | weight_kg | 3DToday → 15 | 11 (anycubic) | «Вес, кг | 15 (нетто)» |
| anycubic.kobra-plus | weight_kg | 3DVision → 7 | 11 (anycubic) | «Вес нетто | 7 кг» |
| anycubic.kobra-s1 | materials_supported | 3DToday → ["ПЛА", "ПЭТ-Г", "АБС", "АСА | ["PLA", "PETG", "TPU", "ABS" (anycubic) | «Материалы | ПЛА, ПЭТ-Г, АБС, АСА, термопластичный полиуретан» |
| anycubic.kobra-s1 | noise_db | 3DToday → 46 | 44 (anycubic) | «Шумность | не более 46 дБ» |
| anycubic.kobra-s1 | noise_db | 3DVision → 46 | 44 (anycubic) | «уровень звукового давления составляет всего 46 дБ в стандарт» |
| anycubic.kobra-s1 | weight_kg | 3DToday → 19 | 18 (anycubic) | «Вес, кг | 19» |
| anycubic.kobra-s1-max | connectivity | 3DToday → ["USB", "Wi-Fi"] | ["Dual-Band Wi-Fi 6", "Ether (anycubic) | «Интерфейс | USB, Wi-Fi» |
| anycubic.kobra-x | noise_db | 3D-DIY → 45 | 48 (anycubic) | «Шум: ≤45 дБ в тихом режиме» |
| anycubic.kobra-x | weight_kg | 3D-DIY → 12.7 | 9.5 (anycubic) | «Вес нетто (кг) 12.7» |
| anycubic.kossel-linear-plus | build_volume | 3DToday → {"x": 230, "y": 230, "z": 27 | {"shape": "round", "x": 240, (cura) | «Область построения, мм: 230x230x270» |
| anycubic.mega-zero | heated_bed | 3DToday → true | false (cura) | «Платформа | С подогревом» |
| anycubic.mega-zero | max_speed_mms | 3D-DIY → 120 | 100 (anycubic) | «Максимальная скорость печати, мм/с 120» |
| anycubic.mega-zero | weight_kg | 3D-DIY → 6 | 6.4 (anycubic) | «Вес нетто (кг) 6» |
| anycubic.predator | connectivity | 3DToday → ["USB", "Card Reader"] | ["Memory card", "Data cable" (anycubic) | «Интерфейсы | USB, Card Reader» |
| anycubic.vyper | connectivity | 3DVision → ["TF Card", "USB-кабель"] | ["Trans-flash Card", "USB ca (anycubic) | «Интерфейсы | TF Card; USB-кабель (для сервисного обслуживани» |
| bambulab.a1 | connectivity | 3D-DIY → ["Wi-Fi"] | ["Bambu Cloud Service", "LAN (bambulab) | «Беспроводная сеть Wi-Fi Да» |
| bambulab.a1 | connectivity | 3DVision → ["Wi-Fi", "Bambu-Bus", "Micr | ["Bambu Cloud Service", "LAN (bambulab) | «Интерфейсы | Wi-Fi/ Bambu-Bus/ Micro SD Card» |
| bambulab.a1 | connectivity | Cvetmir3D → ["Wi-Fi"] | ["Bambu Cloud Service", "LAN (bambulab) | «Интерфейс подключения | Wi-Fi» |
| bambulab.a1 | dimensions_mm | 3D-DIY → {"w": 410, "d": 385, "h": 43 | {"w": 465, "d": 410, "h": 43 (bambulab) | «Габариты товара ДxШxВ (см) 38,5х41х43» |
| bambulab.a1 | dimensions_mm | 3DVision → {"w": 385, "d": 410, "h": 43 | {"w": 465, "d": 410, "h": 43 (bambulab) | «Габариты | 385x410x430 мм» |
| bambulab.a1 | nozzle_hardened | 3DVision → true | false (bambulab) | «Особенности товара | Сопло | закаленная сталь» |
| bambulab.a2l | connectivity | 3DToday → ["WIFI", "Bambu Bus"] | ["Bambu Cloud", "LAN"] (bambulab) | «Интерфейс | Wi-Fi, Bambu Bus» |
| bambulab.h2d | build_volume | 3D-DIY → {"x": 325, "y": 320, "z": 32 | {"x": 350, "y": 320, "z": 32 (bambulab) | «Область печати, XYZ 325x320x325 мм» |
| bambulab.h2d | connectivity | 3D-DIY → ["Wi-Fi"] | ["LAN", "USB"] (bambulab) | «Беспроводная сеть Wi-Fi Да» |
| bambulab.h2d | max_speed_mms | 3D-DIY → 1000 | 600 (bambulab) | «Максимальная скорость печати, мм/с 1000» |
| bambulab.h2d | max_speed_mms | 3DVision → 1000 | 600 (bambulab) | «Скорость печати | до 1000 мм/с» |
| bambulab.h2d | max_speed_mms | Cvetmir3D → 1000 | 600 (bambulab) | «Скорость печати | 1000 мм/с (макс.)» |
| bambulab.p1s | max_speed_mms | 3D-DIY → 450 | 500 (bambulab) | «Максимальная скорость печати, мм/с 450» |
| creality.cr-10-mini | build_volume | 3D-DIY → {"x": 100, "y": 220, "z": 30 | {"shape": "rectangular", "x" (slicer) | «Область печати, XYZ 100x220x300 мм» |
| creality.cr-10-smart | build_volume | Cvetmir3D → {"x": 300, "y": 300, "z": 40 | {"shape": "rectangular", "x" (slicer) | «Размер области построения | 300 х 300 х 400 мм» |
| creality.cr-10-smart-pro | build_volume | Cvetmir3D → {"x": 300, "y": 300, "z": 40 | {"shape": "rectangular", "x" (slicer) | «Размер области построения | 300 х 300 х 400 мм» |
| creality.cr-6-se | build_volume | Cvetmir3D → {"x": 235, "y": 235, "z": 25 | {"shape": "rectangular", "x" (orcaslicer) | «Размер области построения | 235х235х250 мм» |
| creality.cr-m4 | materials_supported | 3DToday → ["АБС", "АСА", "ПЛА", "ТПУ", | ["PLA", "PA (nylon)", "ABS", (creality) | «Расходные материалы | АБС, АСА, ПЛА, ТПУ, ПЭТ-Г и другие» |
| creality.cr-m4 | max_speed_mms | 3DVision → 120 | 500 (slicer) | «Скорость печати | ≤120 мм/сек» |
| creality.ender-3-neo | build_volume | Cvetmir3D → {"x": 220, "y": 220, "z": 25 | {"shape": "rectangular", "x" (slicer) | «Размер области построения | 220х220х250 мм» |
| creality.ender-3-pro | build_volume | Cvetmir3D → {"x": 235, "y": 235, "z": 25 | {"x": 220, "y": 220, "z": 25 (creality) | «Размер области построения | 235х235х250 мм» |
| creality.ender-3-pro | max_speed_mms | Cvetmir3D → 180 | 500 (orcaslicer) | «Скорость печати | макс. 180 мм/с» |
| creality.ender-3-s1-plus | max_speed_mms | Cvetmir3D → 150 | 500 (orcaslicer) | «Скорость печати | макс. 150 мм/с» |
| creality.ender-3-s1-pro | max_speed_mms | Cvetmir3D → 150 | 500 (orcaslicer) | «Скорость печати | макс 150 мм/с» |
| creality.ender-3-v2-neo | max_speed_mms | Cvetmir3D → 120 | 500 (orcaslicer) | «Скорость печати | макс. 120 мм/сек» |
| creality.ender-3-v3 | max_speed_mms | 3DVision → 250 | 600 (creality) | «Скорость печати | 250 мм/с» |
| creality.ender-3-v3-ke | build_volume | Cvetmir3D → {"x": 220, "y": 220, "z": 24 | {"shape": "rectangular", "x" (orcaslicer) | «Размер области построения | 220х220х240 мм» |
| creality.ender-3-v3-plus | connectivity | 3DVision → ["USB"] | ["WiFi"] (creality) | «USB-накопитель - 1 шт.» |
| creality.ender-3-v3-plus | positioning_accuracy_mm | 3DVision → 0.1 | 0.2 (creality) | «Точность | 0,1 мм» |
| creality.ender-5 | max_nozzle_temp_c | 3D-DIY → 260 | 300 (creality) | «Максимальная температура экструдера, °С 260» |
| creality.ender-5 | max_nozzle_temp_c | Cvetmir3D → 260 | 300 (creality) | «Рабочая температура экструдера | до 260 ℃» |
| creality.ender-5 | max_speed_mms | 3D-DIY → 150 | 250 (creality) | «Максимальная скорость печати, мм/с 150» |
| creality.ender-5 | max_speed_mms | 3DToday → 80 | 250 (creality) | «Скорость печати | 80 мм/с» |
| creality.ender-5 | max_speed_mms | Cvetmir3D → 180 | 250 (creality) | «Скорость печати | до 180 мм/с» |
| creality.ender-5-s1 | build_volume | 3D-DIY → {"x": 220, "y": 220, "z": 28 | {"shape": "rectangular", "x" (orcaslicer) | «Область печати, XYZ 220x220x280 мм» |
| creality.ender-5-s1 | build_volume | 3DToday → {"x": 220, "y": 220, "z": 28 | {"shape": "rectangular", "x" (orcaslicer) | «Область построения, мм | 220х220х280» |
| creality.ender-5-s1 | build_volume | 3DVision → {"x": 220, "y": 220, "z": 28 | {"shape": "rectangular", "x" (orcaslicer) | «Печатная область составляет 220x220x280 мм» |
| creality.ender-5-s1 | build_volume | Cvetmir3D → {"x": 220, "y": 220, "z": 28 | {"shape": "rectangular", "x" (orcaslicer) | «Размер области построения | 220х220х280 мм» |
| creality.ender-7 | build_volume | Cvetmir3D → {"x": 250, "y": 250, "z": 30 | {"shape": "rectangular", "x" (slicer) | «Размер области построения | 250 × 250 × 300 мм» |
| creality.k1c | nozzle_hardened | 3DToday → true | false (orcaslicer) | «Хотэнд | цельнометаллический с титановым термобарьером и соп» |
| creality.k1c | nozzle_hardened | 3DVision → true | false (orcaslicer) | «Медное сопло с наконечником из закалённой стали» |
| elegoo.centauri-carbon | max_accel_mms2 | 3DToday → 20 | 20000 (elegoo) | «Максимальные ускорения | 20 м/с^2» |
| elegoo.neptune | build_volume | 3DToday → {"x": 210, "y": 210, "z": 22 | {"x": 225, "y": 225, "z": 26 (elegoo) | «Область построения, мм | 210х210х220» |
| elegoo.neptune | max_nozzle_temp_c | 3DToday → 260 | 300 (elegoo) | «Температура хотэнда | до 260°С» |
| elegoo.neptune | max_speed_mms | 3DToday → 100 | 500 (elegoo) | «Скорость печати | 20-100 мм/с» |
| elegoo.neptune-2d | build_volume | 3DToday → {"x": 220, "y": 220, "z": 25 | {"shape": "rectangular", "x" (cura) | «Область построения, мм | 220х220х250» |
| elegoo.neptune-2s | build_volume | 3D-DIY → {"x": 220, "y": 220, "z": 25 | {"shape": "rectangular", "x" (cura) | «Область печати, XYZ 220x220x250 мм» |
| elegoo.neptune-2s | build_volume | 3DToday → {"x": 220, "y": 220, "z": 25 | {"shape": "rectangular", "x" (cura) | «Область построения, мм | 220х220х250» |
| elegoo.neptune-2s | build_volume | 3DVision → {"x": 220, "y": 220, "z": 25 | {"shape": "rectangular", "x" (cura) | «Область построения имеет размеры 220×220×250 мм» |
| elegoo.neptune-4 | auto_leveling | 3DJake → "2.0 automatic levelling" | "121 (11 x 11) Points Auto B (elegoo) | «Levelling | 2.0 Automatic Levelling over 121 Points» |
| elegoo.neptune-x | build_volume | 3D-DIY → {"x": 220, "y": 220, "z": 30 | {"shape": "rectangular", "x" (cura) | «Область печати, XYZ 220x220x300 мм» |
| elegoo.neptune-x | build_volume | 3DToday → {"x": 220, "y": 220, "z": 30 | {"shape": "rectangular", "x" (cura) | «Область построения, мм | 220х220х300» |
| elegoo.neptune-x | build_volume | 3DVision → {"x": 220, "y": 220, "z": 30 | {"shape": "rectangular", "x" (cura) | «Новая модель имеет увеличенную область построения: 220×220×3» |
| flashforge.ad5x | build_volume | 3D-DIY → {"x": 220, "y": 200, "z": 22 | {"x": 220, "y": 220, "z": 22 (flashforge) | «Область печати, XYZ 220x200x220 мм» |
| flashforge.ad5x | max_nozzle_temp_c | 3D-DIY → 280 | 300 (flashforge) | «Максимальная температура экструдера, °С 280» |
| flashforge.adventurer-4 | build_volume | Cvetmir3D → {"x": 200, "y": 200, "z": 25 | {"shape": "rectangular", "x" (cura) | «Размер области построения | 200*200*250 мм» |
| flashforge.adventurer-5m | air_filter | 3DToday → true | false (flashforge) | «Воздушный фильтр HEPA-фильтр да» |
| flashforge.adventurer-5m | build_volume | 3D-DIY → {"x": 220, "y": 200, "z": 22 | {"x": 220, "y": 220, "z": 22 (flashforge) | «Область печати, XYZ 220x200x220 мм» |
| flashforge.adventurer-5m | build_volume | 3DToday → {"x": 220, "y": 200, "z": 22 | {"x": 220, "y": 220, "z": 22 (flashforge) | «Область печати 220х200х220 мм» |
| flashforge.adventurer-5m | max_bed_temp_c | 3D-DIY → 110 | 100 (flashforge) | «Максимальная температура платформы, °С 110» |
| flashforge.adventurer-5m | max_bed_temp_c | 3DToday → 110 | 100 (flashforge) | «Температура стола 110 °С» |
| flashforge.adventurer-5m | max_bed_temp_c | Cvetmir3D → 110 | 100 (flashforge) | «Температура подогрева площадки | 110℃» |
| flashforge.adventurer-5m | max_nozzle_temp_c | 3DToday → 265 | 280 (flashforge) | «Температура экструдера 265/240 °С» |
| flashforge.adventurer-5m-pro | build_volume | 3D-DIY → {"x": 220, "y": 200, "z": 22 | {"x": 220, "y": 220, "z": 22 (flashforge) | «Область печати, XYZ 220x200x220 мм» |
| flashforge.adventurer-5m-pro | connectivity | 3DToday → ["облако"] | ["Wi-Fi", "Ethernet", "USB"] (flashforge) | «предусмотрена возможность подключения к облаку» |
| flashforge.adventurer-5m-pro | max_bed_temp_c | 3D-DIY → 110 | 100 (flashforge) | «Максимальная температура платформы, °С 110» |
| flashforge.adventurer-5m-pro | max_bed_temp_c | Cvetmir3D → 110 | 100 (flashforge) | «Температура подогрева площадки | 110℃» |
| flashforge.adventurer-5m-pro | noise_db | 3DVision → 50 | 55 (flashforge) | «уровнем шума всего 50 дБ» |
| flashforge.adventurer-5m-pro | noise_db | Cvetmir3D → 50 | 55 (flashforge) | «Шум при работе | 50 Дб» |
| flashforge.creator-5 | max_speed_mms | 3D-DIY → 600 | 300 (flashforge) | «Максимальная скорость печати, мм/с 600» |
| flashforge.creator-5-pro | dimensions_mm | Cvetmir3D → {"w": 520, "d": 425, "h": 72 | {"w": 520, "d": 443, "h": 71 (flashforge) | «Размеры (без упаковки) | 520×425×722 мм» |
| flashforge.creator-5-pro | weight_kg | 3D-DIY → 22 | 18 (flashforge) | «Вес нетто (кг) 22» |
| flsun.super-racer | build_volume | 3D-DIY → {"x": 260, "y": 330, "z": 33 | {"shape": "round", "x": 264, (cura) | «Область печати, XYZ 260x330x330 мм» |
| flsun.v400 | max_speed_mms | 3D-DIY → 400 | 1000 (flsun) | «Максимальная скорость печати, мм/с 400» |
| flsun.v400 | max_speed_mms | 3DVision → 400 | 1000 (flsun) | «Скорость печати | до 400 мм/сек» |
| geeetech.a10t | build_volume | 3DToday → {"x": 220, "y": 220, "z": 25 | {"shape": "rectangular", "x" (cura) | «Область построения, мм: 220*220*250» |
| kingroon.kp3s | max_speed_mms | 3DToday → 60 | 500 (kingroon) | «Скорость печати | <=60 mm/s» |
| kingroon.kp3s-pro | build_volume | 3DToday → {"x": 180, "y": 180, "z": 18 | {"x": 200, "y": 200, "z": 20 (kingroon) | «KINGROON 180x180x180 мм» |
| leapfrog-b-v.leapfrog-creatr-hs | build_volume | 3DToday → {"x": 270, "y": 260, "z": 18 | {"shape": "rectangular", "x" (cura) | «Область построения, мм: 270x260x180» |
| longer.lk1 | materials_supported | 3DToday → ["ABS-пластик", "PLA-пластик | ["PLA", "ABS", "Wood"] (longer) | «Материалы | ABS-пластик PLA-пластик PETG» |
| longer.lk1 | max_speed_mms | 3DToday → 150 | 180 (longer) | «Скорость печати | 20-150 мм/с» |
| longer.lk4 | materials_supported | 3DToday → ["ABS-пластик", "PLA-пластик | ["PLA", "ABS", "Wood"] (longer) | «Материалы | ABS-пластик PLA-пластик PETG» |
| longer.lk4 | max_speed_mms | 3DToday → 150 | 180 (longer) | «Скорость печати | 20-150 мм/с» |
| makergear.m2 | materials_supported | 3DToday → ["ABS-пластик", "PLA-пластик | ["PLA", "ABS", "PET", "HIPS" (makergear) | «Материалы | ABS-пластик PLA-пластик» |
| peopoly.magneto-x | nozzle_hardened | Cvetmir3D → true | false (slicer) | «Сопло из закаленной стали со сменными зонами расплава... вхо» |
| qidi.q1-pro | build_volume | Cvetmir3D → {"x": 245, "y": 245, "z": 24 | {"shape": "rectangular", "x" (orcaslicer) | «Размер области построения | 245х245х245 мм» |
| qidi.q2 | max_accel_mms2 | 3DToday → 20 | 20000 (qidi) | «Максимальные ускорения | 20 мм/с» |
| qidi.q2c | max_accel_mms2 | 3DToday → 20 | 20000 (qidi) | «Максимальные ускорения | 20 м/с^2» |
| qidi.q2c | weight_kg | 3DToday → 18 | 16.9 (qidi) | «Вес | 18 кг (нетто)» |
| qidi.x-max | build_volume | 3D-DIY → {"x": 300, "y": 250, "z": 30 | {"x": 325, "y": 325, "z": 31 (qidi) | «Область печати, XYZ 300x250x300 мм» |
| qidi.x-max | build_volume | 3DToday → {"x": 300, "y": 250, "z": 30 | {"x": 325, "y": 325, "z": 31 (qidi) | «Максимальная область построения, мм | 300x250x300mm» |
| qidi.x-max | chamber_active | 3D-DIY → false | true (qidi) | «Активная термокамера Нет» |
| qidi.x-max | dimensions_mm | 3D-DIY → {"w": 510, "d": 580, "h": 55 | {"w": 553, "d": 553, "h": 60 (qidi) | «Габариты товара ДxШxВ (см) 58х51х55» |
| qidi.x-max | dimensions_mm | 3DToday → {"w": 500, "d": 550, "h": 80 | {"w": 553, "d": 553, "h": 60 (qidi) | «Размеры, мм | 500x550x800» |
| qidi.x-max | max_nozzle_temp_c | 3D-DIY → 300 | 350 (qidi) | «Максимальная температура экструдера, °С 300» |
| qidi.x-max | max_speed_mms | 3D-DIY → 180 | 600 (qidi) | «Максимальная скорость печати, мм/с 180» |
| qidi.x-max | weight_kg | 3D-DIY → 37 | 30.2 (qidi) | «Вес нетто (кг) 37» |
| qidi.x-max | weight_kg | 3DToday → 28 | 30.2 (qidi) | «Вес, кг | 28» |
| raise3d.pro3 | build_volume | 3D-DIY → {"x": 300, "y": 300, "z": 30 | {"shape": "rectangular", "x" (orcaslicer) | «Область печати, XYZ 300x300x300 мм» |
| raise3d.pro3 | build_volume | 3DToday → {"x": 300, "y": 300, "z": 30 | {"shape": "rectangular", "x" (orcaslicer) | «Область построения, мм | 300х300х300 мм (одним экструдером)» |
| raise3d.pro3 | build_volume | Cvetmir3D → {"x": 300, "y": 300, "z": 30 | {"shape": "rectangular", "x" (orcaslicer) | «Размер области построения | 300×300×300 мм (печать 1-им экст» |
| sovol.sv06 | power_loss_recovery | 3DToday → true | false (sovol) | «Функция сохранения | есть» |
| sovol.sv06-plus | connectivity | 3DToday → ["USB", "MicroSD"] | ["Wi-Fi"] (sovol) | «Интерфейс | MicroSD, USB» |
| sovol.sv06-plus | power_loss_recovery | 3DToday → true | false (sovol) | «Функция сохранения | есть» |
| sovol.sv08 | power_w | 3DJake → 1000 | 150 (sovol) | «Rated voltage / Rated power | 100-240VAC, 50/60Hz | 1000 W a» |
| sovol.sv08-max | connectivity | 3D-DIY → ["Wi-Fi"] | ["CAN bus", "USB", "Wi-Fi (2 (sovol) | «Беспроводная сеть Wi-Fi Да» |
| tevo.black-widow | build_volume | 3DToday → {"x": 370, "y": 250, "z": 30 | {"shape": "rectangular", "x" (cura) | «Область построения, мм: 370x250x300» |
| thecooltool.uni-print-3d | heated_bed | 3DToday → false | true (cura) | «Платформа | Без подогрева» |
| tronxy.d01 | heated_bed | 3DToday → false | true (cura) | «Без подогрева» |
| tronxy.xy-3 | build_volume | 3DToday → {"x": 310, "y": 310, "z": 40 | {"shape": "rectangular", "x" (cura) | «Область построения, мм | 310х310х400» |
| two-trees.sapphire-pro | build_volume | 3DToday → {"x": 235, "y": 235, "z": 22 | {"shape": "rectangular", "x" (cura) | «Максимальная область построения, мм | 235х235х220» |
| ultimaker.s7 | build_volume | 3DToday → {"x": 330, "y": 240, "z": 33 | {"shape": "rectangular", "x" (cura) | «Область построения, мм | 330х240х330» |
| wanhao.duplicator-5s-mini | build_volume | 3DToday → {"x": 295, "y": 195, "z": 20 | {"shape": "rectangular", "x" (cura) | «Область построения, мм: 295x195x205» |
| wanhao.duplicator-5s-mini | build_volume | Cvetmir3D → {"x": 295, "y": 195, "z": 20 | {"shape": "rectangular", "x" (cura) | «Размер области построения | 295 × 195 × 205 мм» |
| wanhao.duplicator-6 | build_volume | 3DToday → {"x": 200, "y": 200, "z": 20 | {"shape": "rectangular", "x" (cura) | «Область построения, мм: 200x200x200» |
| wanhao.duplicator-i3-mini | build_volume | 3DToday → {"x": 150, "y": 150, "z": 11 | {"shape": "rectangular", "x" (cura) | «Область построения, мм: 150x150x115» |
| wanhao.duplicator-i3-mini | build_volume | Cvetmir3D → {"x": 120, "y": 135, "z": 10 | {"shape": "rectangular", "x" (cura) | «Размер области построения | 120 × 135 × 100 мм» |

## 3. Согласованность внутри карточки (80)

Проверки без моделей: объём ≤ габаритов, стол при подогреве, сопло ≥ 180 °C,
вес против размеров, скорость против ускорения, мультиматериал без каналов.

| Станок | Проверка | a | b |
|---|---|---|---|
| anet.a6 | speed_vs_accel | 500 | 500 |
| anet.a8 | speed_vs_accel | 500 | 500 |
| anet.a8-plus | speed_vs_accel | 500 | 500 |
| anet.e10 | speed_vs_accel | 500 | 500 |
| anet.et4 | speed_vs_accel | 500 | 500 |
| anet.et4-pro | speed_vs_accel | 500 | 500 |
| anet.et5 | speed_vs_accel | 500 | 500 |
| artillery.genius | speed_vs_accel | 500 | 2000 |
| artillery.genius-pro | speed_vs_accel | 500 | 2000 |
| artillery.hornet | speed_vs_accel | 500 | 2000 |
| biqu.b1 | speed_vs_accel | 500 | 1000 |
| biqu.bx | speed_vs_accel | 500 | 1000 |
| creality.cr-10 | speed_vs_accel | 500 | 500 |
| creality.cr-10-max | speed_vs_accel | 500 | 500 |
| creality.cr-10-mini | speed_vs_accel | 500 | 500 |
| creality.cr-10-s | speed_vs_accel | 500 | 500 |
| creality.cr-10-s-pro | speed_vs_accel | 500 | 500 |
| creality.cr-10-s-pro-v2 | speed_vs_accel | 500 | 500 |
| creality.cr-10-smart | speed_vs_accel | 500 | 500 |
| creality.cr-10-smart-pro | speed_vs_accel | 500 | 500 |
| creality.cr-10-v2 | speed_vs_accel | 500 | 500 |
| creality.cr-10-v3 | speed_vs_accel | 500 | 500 |
| creality.cr-20 | speed_vs_accel | 500 | 500 |
| creality.cr-20-pro | speed_vs_accel | 500 | 500 |
| creality.cr-200b | speed_vs_accel | 500 | 500 |
| creality.cr-5-pro | speed_vs_accel | 500 | 500 |
| creality.cr-5-pro-h | speed_vs_accel | 500 | 500 |
| creality.cr-6-max | speed_vs_accel | 500 | 500 |
| creality.cr-6-se | speed_vs_accel | 500 | 500 |
| creality.cr-m4 | speed_vs_accel | 500 | 500 |
| creality.ender-2 | speed_vs_accel | 500 | 500 |
| creality.ender-2-pro | speed_vs_accel | 500 | 500 |
| creality.ender-3 | speed_vs_accel | 500 | 500 |
| creality.ender-3-max | speed_vs_accel | 500 | 500 |
| creality.ender-3-max-neo | speed_vs_accel | 500 | 500 |
| creality.ender-3-neo | speed_vs_accel | 500 | 500 |
| creality.ender-3-pro | speed_vs_accel | 500 | 500 |
| creality.ender-3-s1 | speed_vs_accel | 500 | 500 |
| creality.ender-3-s1-plus | speed_vs_accel | 500 | 1500 |
| creality.ender-3-s1-pro | speed_vs_accel | 500 | 500 |
| creality.ender-3-v2 | speed_vs_accel | 500 | 500 |
| creality.ender-3-v2-neo | speed_vs_accel | 500 | 500 |
| creality.ender-5-pro | speed_vs_accel | 500 | 500 |
| creality.ender-5s | speed_vs_accel | 500 | 500 |
| creality.ender-6 | speed_vs_accel | 500 | 500 |
| creality.ender-7 | speed_vs_accel | 500 | 500 |
| creality.sermoon-d1 | speed_vs_accel | 500 | 500 |
| elegoo.neptune | speed_vs_accel | 500 | 500 |
| elegoo.neptune-2 | speed_vs_accel | 500 | 500 |
| elegoo.neptune-3 | speed_vs_accel | 500 | 500 |
| elegoo.neptune-3-max | speed_vs_accel | 500 | 500 |
| elegoo.neptune-3-plus | speed_vs_accel | 500 | 500 |
| elegoo.neptune-3-pro | speed_vs_accel | 500 | 500 |
| flashforge.dreamer-nx | speed_vs_accel | 500 | 1500 |
| geeetech.i3-prob | speed_vs_accel | 500 | 500 |
| geeetech.i3-proc | speed_vs_accel | 500 | 500 |
| geeetech.me-creator2 | speed_vs_accel | 500 | 500 |
| goofoo.max | speed_vs_accel | 500 | 500 |
| goofoo.mido | speed_vs_accel | 500 | 500 |
| goofoo.mini | speed_vs_accel | 500 | 500 |
| goofoo.nova | speed_vs_accel | 500 | 500 |
| goofoo.plus | speed_vs_accel | 500 | 500 |
| goofoo.tiny | speed_vs_accel | 500 | 500 |
| longer.lk5-pro | speed_vs_accel | 500 | 500 |
| lulzbot.taz-4-or-5 | speed_vs_accel | 500 | 500 |
| lulzbot.taz-6 | speed_vs_accel | 500 | 500 |
| mingda.d2 | speed_vs_accel | 500 | 500 |
| mingda.magician-max | speed_vs_accel | 500 | 500 |
| mingda.magician-pro | speed_vs_accel | 500 | 500 |
| mingda.magician-x | speed_vs_accel | 500 | 500 |
| mixware.hyper-s | speed_vs_accel | 500 | 500 |
| raise3d.pro3 | speed_vs_accel | 500 | 1000 |
| raise3d.pro3-plus | speed_vs_accel | 500 | 1000 |
| sovol.sv01 | speed_vs_accel | 500 | 500 |
| sovol.sv01-pro | speed_vs_accel | 500 | 500 |
| sovol.sv02 | speed_vs_accel | 500 | 500 |
| sovol.sv03 | speed_vs_accel | 500 | 500 |
| sovol.sv05 | speed_vs_accel | 500 | 500 |
| voxelab.aquila-x2 | speed_vs_accel | 500 | 500 |
| wanhao.d12-300 | speed_vs_accel | 500 | 1000 |

## 4. После второго помощника (`q38`)

Записей прошло второго помощника: 314; полей, подтверждённых ОБОИМИ помощниками (`double_verified`): **3840**; снято вторым: **14**; осталось неподтверждённых: **58**.

### Подтверждено обоими — по видам полей

| Поле | Сколько |
|---|---|
| build_volume | 231 |
| dimensions_mm | 221 |
| heated_bed | 218 |
| max_nozzle_temp_c | 217 |
| max_speed_mms | 210 |
| nozzle_diameters | 209 |
| max_bed_temp_c | 188 |
| extruder_count | 186 |
| connectivity | 175 |
| materials_supported | 175 |
| filament_runout_sensor | 170 |
| weight_kg | 148 |
| power_loss_recovery | 147 |
| filament_diameter_mm | 125 |
| enclosed | 117 |
| camera | 111 |
| layer_height_max_mm | 99 |
| price_rub | 96 |
| power_w | 91 |
| layer_height_min_mm | 88 |
| extruder_type | 83 |
| max_accel_mms2 | 81 |
| chamber_active | 69 |
| kinematics | 59 |
| price_usd | 51 |
| air_filter | 39 |
| noise_db | 39 |
| positioning_accuracy_mm | 29 |
| max_flow_mm3s | 27 |
| nozzle_hardened | 26 |

### Снял второй помощник

| Запись | Поле | Значение |
|---|---|---|
| anycubic.kobra-2-neo | materials_supported | ["PLA", "ABS", "ASA", "PETG", "TPU"] |
| second:Cvetmir3D:creality.ender-3-pro | materials_supported | ["ABS", "PLA", "TPU"] |
| second:3DToday:creality.cr-m4 | materials_supported | ["АБС", "АСА", "ПЛА", "ТПУ", "ПЭТ-Г", "и |
| second:Cvetmir3D:elegoo.neptune-4 | voltage_v | 230 |
| second:Cvetmir3D:creality.cr-10-smart | noise_db | 45 |
| second:Cvetmir3D:creality.cr-10-smart | materials_supported | ["ABS", "PLA", "PETG", "TPU"] |
| second:3DVision:creality.ender-3-pro | max_travel_speed_mms | 180 |
| second:3DJake:elegoo.centauri-carbon | nozzle_hardened | true |
| second:3DToday:anycubic.kobra-plus | power_w | 45 |
| second:3DToday:kingroon.kp3s | weight_kg | 5 |
| second:Cvetmir3D:wanhao.duplicator-i3-mini | materials_supported | ["PLA"] |
| second:3D-DIY:raise3d.pro3 | dimensions_mm | {"w": 626, "d": 620, "h": 760} |
| second:3D-DIY:creality.k1c | chamber_active | false |
| second:3DToday:creality.k1c | max_accel_mms2 | 20000 |

### Осталось неподтверждённым — второй помощник тоже «не сказано»

Поле держится на дословной цитате; ни один помощник не подтвердил. В каталог — с пометкой.

| Поле | Сколько | Примеры (запись, значение, цитата) |
|---|---|---|
| kinematics | 15 | sovol.sv06: "cartesian" «Klipper: I3 3D Printer»; sovol.sv06-ace: "cartesian" «Klipper: I3 3D Printer» |
| heated_bed | 10 | kingroon.klp1: true «The auto bed leveling comes to Kingroon »; elegoo.neptune-4-plus: true «121 (11 × 11) Points Auto Bed Leveling» |
| enclosed | 10 | qidi.x-max-3: true «Temperature Controlled Chamber And Dryin»; qidi.x-max: true «Temperature Controlled Chamber And Dryin» |
| filament_diameter_mm | 7 | elegoo.neptune-4-max: 1.75 «PLA Filament 1.75mm Grey 10KG»; elegoo.neptune-4-plus: 1.75 «PLA Filament 1.75mm Grey 10KG» |
| nozzle_hardened | 7 | seemecnc.rostockmax-v3-2: true «nozzles brass and stainless diameters 0.»; nd:Cvetmir3D:anycubic.4max-pro: true «титановым экструдером» |
| power_loss_recovery | 3 | ond:3DToday:anycubic.kobra-neo: true «Функция сохранения | есть»; second:3DToday:sovol.sv06-plus: true «Функция сохранения | есть» |
| release_year | 2 | creality.sermoon-v1: 2022 «Creality Came into Spotlight at Formnext»; archive:peopoly.moai: 2017 «© 2017, Peopoly» |
| filament_runout_sensor | 1 | bambulab.h2c: true «Full Filament Path AI Error Detection» |
| extruder_type | 1 | seemecnc.bossdelta-300: "bowden" «Bowden Hotend» |
| connectivity | 1 | ision:creality.ender-3-v3-plus: ["USB"] «USB-накопитель - 1 шт.» |
| power_w | 1 | second:3DVision:wanhao.d12-300: 1000 «Электропитание | 100-250В, ~4 A, 50-60HZ» |
