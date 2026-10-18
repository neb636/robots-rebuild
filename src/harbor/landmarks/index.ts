// Every hand-built landmark, by the key it has in art/source/boston/landmarks.json.
import type { LandmarkBuilder } from './types';
import { faneuil } from './faneuil';
import { quincy, northMarket, southMarket } from './markets';
import { marriott, customHouseBlock, chartHouse } from './longwharf';
import { aquarium } from './aquarium';
import { customHouse, harborTowers, rowesWharf } from './skyline';
import { paulRevere, oldStateHouse, cityHall, carousel } from './historic';

export const LANDMARKS: Record<string, LandmarkBuilder> = {
  faneuil, quincy, northMarket, southMarket,
  marriott, customHouseBlock, chartHouse,
  aquarium,
  customHouse, harborTowers, rowesWharf,
  paulRevere, oldStateHouse, cityHall, carousel,
};
