import { Permission } from '@bookorbit/types';
import { Body, Controller, Get, HttpCode, HttpStatus, Put } from '@nestjs/common';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { UpdateTtsConfigDto } from './dto/update-tts-config.dto';
import { EpubTtsConfigService } from './epub-tts-config.service';

@Controller('tts/epub-providers')
@RequirePermission(Permission.ManageAppSettings)
export class EpubTtsConfigController {
  constructor(private readonly service: EpubTtsConfigService) {}

  @Get()
  async getConfig() {
    const config = await this.service.getConfig();
    const statuses = await this.service.getProviderStatuses(config);
    return { config, statuses };
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  updateConfig(@Body() dto: UpdateTtsConfigDto) {
    return this.service.updateConfig(dto);
  }
}
