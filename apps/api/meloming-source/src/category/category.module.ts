import { Module } from '@nestjs/common';
import { CategoryService } from './category.service';
import { CategoryController } from './category.controller';
import { ChannelModule } from '../channel/channel.module';

@Module({
  imports: [ChannelModule],
  providers: [CategoryService],
  controllers: [CategoryController],
})
export class CategoryModule {}
